import { createHash } from 'node:crypto';
import { dockerError, dockerHttpRequest } from './docker-http.js';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';

/**
 * Keeps the TLS edge of the managed gateway (ADR-167) on the configuration
 * that ships with this Agent. The installer creates the edge once; without
 * this, a new Agent release could never change how the edge behaves.
 *
 * Boundaries: it only touches a container named like the installer's edge that
 * carries the installer's label, reuses that container's own image, and writes
 * only the Caddyfile below into the installer's state directory.
 */
export const GATEWAY_EDGE_NAME = 'initpad-gateway-edge';
export const GATEWAY_EDGE_LABEL = 'com.initpad.gateway.installer';
export const GATEWAY_EDGE_CONFIG_LABEL = 'com.initpad.gateway.edge-config';
const STATE_DIR = '/var/lib/initpad-gateway';
const CADDYFILE_MOUNT = '/etc/caddy/Caddyfile';
const DNS_NAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IMAGE = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const NETWORK = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SETTLE_MS = 6_000;
const RESTORE_TIMEOUT_MS = 60_000;

// Must stay byte-identical to the heredoc in install.sh (checked by a test).
export const GATEWAY_EDGE_CADDYFILE = `{
	admin off
	# Explicit issuer: for names such as *.local Caddy would otherwise pick
	# its own internal CA instead of the private CA the Agent trusts.
	cert_issuer acme {
		dir https://ca:9000/acme/acme/directory
		trusted_roots /etc/caddy/ca-root.crt
	}
	on_demand_tls {
		ask http://127.0.0.1:5555/allowed
	}
}

http://127.0.0.1:5555 {
	bind 127.0.0.1
	@allowed expression {query.domain}.endsWith('.{$GATEWAY_DOMAIN}') && {query.domain}.size() <= 253
	respond @allowed 200
	respond 403
}

# The public CA root may be downloaded over HTTP, because a browser cannot trust
# the CA before it has it. Every other plain-HTTP request goes to HTTPS.
http://{$GATEWAY_DOMAIN} {
	handle /initpad-ca.crt {
		root * /etc/caddy
		rewrite * /ca-root.crt
		header Content-Type application/x-x509-ca-cert
		header Content-Disposition \`attachment; filename="initpad-gateway-ca.crt"\`
		file_server
	}
	handle {
		redir https://{host}{uri} 308
	}
}

{$GATEWAY_DOMAIN} {
	header -Server
	reverse_proxy initpad-gateway:8080
}

https:// {
	tls {
		on_demand
	}
	header -Server
	reverse_proxy initpad-gateway:8080
}
`;

export function gatewayEdgeConfigVersion(caddyfile = GATEWAY_EDGE_CADDYFILE): string {
  return createHash('sha256').update(caddyfile).digest('hex').slice(0, 16);
}

export type GatewayEdgeResult =
  | { status: 'absent' }
  | { status: 'current'; version: string }
  | { status: 'updated'; version: string };

interface EdgeInspect {
  Id?: string;
  Config?: {
    Image?: string;
    Env?: string[];
    Labels?: Record<string, string>;
    ExposedPorts?: Record<string, unknown>;
  };
  HostConfig?: Record<string, unknown> & { NetworkMode?: string };
  State?: { Running?: boolean; Restarting?: boolean };
  Mounts?: { Type?: string; Source?: string; Destination?: string }[];
}

function json<T>(response: DockerHttpResponse, action: string): T {
  if (response.statusCode < 200 || response.statusCode >= 300) throw dockerError(response, action);
  try {
    return JSON.parse(response.body.toString('utf8')) as T;
  } catch {
    throw new Error(`Docker API returned invalid JSON for ${action}`);
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export class GatewayEdgeReconciler {
  constructor(
    private readonly dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    private readonly transport: DockerTransport = dockerHttpRequest,
    private readonly settleMs = SETTLE_MS,
  ) {}

  async reconcile(signal: AbortSignal): Promise<GatewayEdgeResult> {
    const version = gatewayEdgeConfigVersion();
    let edge = await this.inspect(GATEWAY_EDGE_NAME, signal);
    if (!edge) {
      // A crash between parking the old edge and starting its replacement
      // leaves only the parked container. Putting it back is always safe: it
      // is exactly the edge that served before the interrupted update.
      if (!(await this.restoreParked(signal))) return { status: 'absent' };
      edge = await this.inspect(GATEWAY_EDGE_NAME, signal);
      if (!edge) return { status: 'absent' };
    }
    const plan = this.plan(edge);
    if (!plan) return { status: 'absent' };
    if (edge.Config?.Labels?.[GATEWAY_EDGE_CONFIG_LABEL] === version) {
      return { status: 'current', version };
    }

    await this.writeFiles(plan.image, 'update', signal);
    const previousName = `${GATEWAY_EDGE_NAME}-previous`;
    await this.remove(previousName, signal);
    let parked = false;
    try {
      await this.post(
        `/containers/${GATEWAY_EDGE_NAME}/stop?t=10`,
        [204, 304],
        'stop gateway edge',
        signal,
      );
      await this.post(
        `/containers/${GATEWAY_EDGE_NAME}/rename?name=${previousName}`,
        [204],
        'park gateway edge',
        signal,
      );
      parked = true;
      const created = json<{ Id?: unknown }>(
        await this.request({
          method: 'POST',
          path: `/containers/create?name=${GATEWAY_EDGE_NAME}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            Image: plan.image,
            Env: edge.Config?.Env,
            ExposedPorts: edge.Config?.ExposedPorts,
            Labels: { ...edge.Config?.Labels, [GATEWAY_EDGE_CONFIG_LABEL]: version },
            HostConfig: edge.HostConfig,
            NetworkingConfig: { EndpointsConfig: { [plan.network]: {} } },
          }),
          signal,
        }),
        'create gateway edge',
      );
      if (typeof created.Id !== 'string') throw new Error('Docker returned an invalid edge id');
      await this.post(`/containers/${created.Id}/start`, [204, 304], 'start gateway edge', signal);
      await pause(this.settleMs, signal);
      const started = await this.inspect(GATEWAY_EDGE_NAME, signal);
      if (!started?.State?.Running || started.State.Restarting) {
        throw new Error('The updated gateway edge did not stay running');
      }
      await this.remove(previousName, signal);
      return { status: 'updated', version };
    } catch (error) {
      // The caller's signal may be the reason for this failure (shutdown,
      // abort); restoring the serving edge must still run, bounded on its own.
      const restoreSignal = AbortSignal.timeout(RESTORE_TIMEOUT_MS);
      if (parked) {
        await this.remove(GATEWAY_EDGE_NAME, restoreSignal).catch(() => undefined);
        await this.writeFiles(plan.image, 'restore', restoreSignal).catch(() => undefined);
        await this.post(
          `/containers/${previousName}/rename?name=${GATEWAY_EDGE_NAME}`,
          [204],
          'restore gateway edge',
          restoreSignal,
        ).catch(() => undefined);
      }
      await this.post(
        `/containers/${GATEWAY_EDGE_NAME}/start`,
        [204, 304],
        'restart gateway edge',
        restoreSignal,
      ).catch(() => undefined);
      throw error;
    }
  }

  private async restoreParked(signal: AbortSignal): Promise<boolean> {
    const previousName = `${GATEWAY_EDGE_NAME}-previous`;
    const parked = await this.inspect(previousName, signal);
    if (!parked) return false;
    const plan = this.plan(parked);
    if (!plan) return false;
    await this.writeFiles(plan.image, 'restore', signal).catch(() => undefined);
    await this.post(
      `/containers/${previousName}/rename?name=${GATEWAY_EDGE_NAME}`,
      [204],
      'restore parked gateway edge',
      signal,
    );
    await this.post(
      `/containers/${GATEWAY_EDGE_NAME}/start`,
      [204, 304],
      'restart parked gateway edge',
      signal,
    );
    return true;
  }

  private plan(edge: EdgeInspect): { image: string; network: string } | null {
    if (edge.Config?.Labels?.[GATEWAY_EDGE_LABEL] !== 'true') return null;
    const image = edge.Config.Image;
    if (!image || !IMAGE.test(image)) throw new Error('The gateway edge image is not immutable');
    const domain = (edge.Config.Env ?? [])
      .find((item) => item.startsWith('GATEWAY_DOMAIN='))
      ?.slice('GATEWAY_DOMAIN='.length);
    if (!domain || !DNS_NAME.test(domain)) throw new Error('The gateway edge has no valid domain');
    const caddyfile = (edge.Mounts ?? []).find((mount) => mount.Destination === CADDYFILE_MOUNT);
    if (caddyfile?.Type !== 'bind' || caddyfile.Source !== `${STATE_DIR}/Caddyfile`) {
      throw new Error('The gateway edge does not use the installer state directory');
    }
    const network = edge.HostConfig?.NetworkMode;
    if (!network || !NETWORK.test(network) || network === 'host' || network === 'none') {
      throw new Error('The gateway edge is not on its own Docker network');
    }
    return { image, network };
  }

  /** Writes the Caddyfile (keeping the old one aside) or puts the old one back. */
  private async writeFiles(
    image: string,
    mode: 'update' | 'restore',
    signal: AbortSignal,
  ): Promise<void> {
    const script =
      mode === 'update'
        ? 'cp -p /state/Caddyfile /state/Caddyfile.previous && printf %s "$EDGE_CADDYFILE" > /state/Caddyfile.new && chmod 0644 /state/Caddyfile.new && mv /state/Caddyfile.new /state/Caddyfile'
        : 'mv -f /state/Caddyfile.previous /state/Caddyfile';
    const name = `initpad-gateway-edge-config-${Date.now().toString(36)}`;
    const created = json<{ Id?: unknown }>(
      await this.request({
        method: 'POST',
        path: `/containers/create?name=${name}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          Image: image,
          Entrypoint: ['sh', '-c'],
          Cmd: [script],
          Env: [`EDGE_CADDYFILE=${GATEWAY_EDGE_CADDYFILE}`],
          Labels: { 'com.initpad.gateway.helper': 'true' },
          NetworkDisabled: true,
          HostConfig: {
            Binds: [`${STATE_DIR}:/state`],
            NetworkMode: 'none',
            CapDrop: ['ALL'],
            CapAdd: ['DAC_OVERRIDE', 'CHOWN', 'FOWNER'],
            SecurityOpt: ['no-new-privileges'],
            Memory: 32 * 1024 * 1024,
            PidsLimit: 32,
          },
        }),
        signal,
      }),
      'create gateway config helper',
    );
    if (typeof created.Id !== 'string') throw new Error('Docker returned an invalid helper id');
    try {
      await this.post(
        `/containers/${created.Id}/start`,
        [204],
        'start gateway config helper',
        signal,
      );
      const result = json<{ StatusCode?: unknown }>(
        await this.request({
          method: 'POST',
          path: `/containers/${created.Id}/wait?condition=not-running`,
          timeoutMs: 25_000,
          signal,
        }),
        'wait for gateway config helper',
      );
      if (result.StatusCode !== 0)
        throw new Error('The gateway configuration could not be written');
    } finally {
      await this.remove(created.Id, AbortSignal.timeout(RESTORE_TIMEOUT_MS)).catch(() => undefined);
    }
  }

  private async inspect(name: string, signal: AbortSignal): Promise<EdgeInspect | null> {
    const response = await this.request({
      method: 'GET',
      path: `/containers/${encodeURIComponent(name)}/json`,
      signal,
    });
    if (response.statusCode === 404) return null;
    return json<EdgeInspect>(response, 'inspect gateway edge');
  }

  private async remove(name: string, signal: AbortSignal): Promise<void> {
    await this.post(
      `/containers/${encodeURIComponent(name)}?force=true&v=false`,
      [204, 404],
      'remove gateway container',
      signal,
      'DELETE',
    );
  }

  private async post(
    path: string,
    expected: number[],
    action: string,
    signal: AbortSignal,
    method: 'POST' | 'DELETE' = 'POST',
  ): Promise<void> {
    const response = await this.request({ method, path, signal });
    if (!expected.includes(response.statusCode)) throw dockerError(response, action);
  }

  private request(input: DockerHttpRequest): Promise<DockerHttpResponse> {
    return this.transport(input, this.dockerHost);
  }
}
