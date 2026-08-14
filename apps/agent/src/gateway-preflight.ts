import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface GatewayPreflightPayload {
  adapter: 'caddy';
  publicUrl: string;
}

export interface GatewayPreflightProgress {
  percent: number;
  stage: 'working' | 'verifying';
  message: string;
}

type ProgressReporter = (progress: GatewayPreflightProgress) => Promise<void>;

export interface GatewayPreflightDependencies {
  resolve(hostname: string): Promise<Array<{ address: string; family: number }>>;
  verifyTls(hostname: string, signal: AbortSignal): Promise<void>;
  verifyCaddy(signal: AbortSignal): Promise<void>;
}

export function parseGatewayPreflightPayload(value: unknown): GatewayPreflightPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Gateway preflight payload is invalid');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['adapter', 'publicUrl'].includes(key))) {
    throw new Error('Gateway preflight payload contains unsupported fields');
  }
  if (input.adapter !== 'caddy' || typeof input.publicUrl !== 'string') {
    throw new Error('Gateway preflight payload is invalid');
  }
  let url: URL;
  try {
    url = new URL(input.publicUrl);
  } catch {
    throw new Error('Gateway preflight requires a valid HTTPS DNS origin');
  }
  const labels = url.hostname.split('.');
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || isIP(url.hostname) !== 0
    || labels.some((label) => !DNS_LABEL.test(label))
  ) {
    throw new Error('Gateway preflight requires a valid HTTPS DNS origin');
  }
  return { adapter: 'caddy', publicUrl: url.origin.toLowerCase() };
}

function privateAddress(address: string): boolean {
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb')) return true;
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

async function verifyTrustedTls(hostname: string, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = tlsConnect({
      host: hostname,
      port: 443,
      servername: hostname,
      rejectUnauthorized: true,
    });
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      socket.removeListener('error', fail);
      socket.setTimeout(0);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(new Error('Gateway TLS handshake failed'));
    };
    const abort = () => fail();
    signal.addEventListener('abort', abort, { once: true });
    socket.setTimeout(10_000, fail);
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.end();
      resolve();
    });
  });
}

export class CaddyAdminAdapter {
  constructor(
    private readonly adminUrl = process.env.INITPAD_AGENT_GATEWAY_ADMIN_URL ?? '',
    private readonly resolve: GatewayPreflightDependencies['resolve'] =
      (hostname) => lookup(hostname, { all: true }),
    private readonly request: typeof fetch = fetch,
  ) {}

  async ready(signal: AbortSignal): Promise<void> {
    if (!this.adminUrl) {
      throw new Error('Caddy adapter is not configured on this Agent');
    }
    let url: URL;
    try {
      url = new URL(this.adminUrl);
    } catch {
      throw new Error('Caddy adapter URL is invalid');
    }
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash
    ) {
      throw new Error('Caddy adapter URL must be a private HTTP(S) origin');
    }
    const addresses = await this.resolve(url.hostname);
    if (!addresses.length || addresses.some(({ address }) => !privateAddress(address))) {
      throw new Error('Caddy adapter must resolve only to private target addresses');
    }
    const response = await this.request(new URL('/config/', url), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Caddy adapter readiness returned HTTP ${response.status}`);
    const config: unknown = await response.json();
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Caddy adapter returned an invalid configuration document');
    }
  }
}

export class GatewayPreflight {
  constructor(private readonly dependencies: GatewayPreflightDependencies = {
    resolve: (hostname) => lookup(hostname, { all: true }),
    verifyTls: verifyTrustedTls,
    verifyCaddy: (signal) => new CaddyAdminAdapter().ready(signal),
  }) {}

  async run(
    rawPayload: unknown,
    signal: AbortSignal,
    report: ProgressReporter,
  ): Promise<void> {
    const payload = parseGatewayPreflightPayload(rawPayload);
    const gatewayHostname = new URL(payload.publicUrl).hostname;
    // A wildcard certificate for *.apps.example.test does not cover the zone
    // apex apps.example.test. Resolve a one-label-deep probe to verify wildcard
    // DNS, but verify TLS on the explicit gateway origin. Per-route Caddy
    // certificates are created only with a real route in the next phase;
    // preflight must not accidentally require an optional wildcard cert.
    const dnsProbeHostname = `initpad-preflight.${gatewayHostname}`;
    if (dnsProbeHostname.length > 253) {
      throw new Error('Gateway DNS zone is too long for application hostnames');
    }

    await report({ percent: 15, stage: 'working', message: 'Resolving wildcard gateway DNS' });
    const addresses = await this.dependencies.resolve(dnsProbeHostname)
      .catch(() => { throw new Error('Gateway DNS lookup failed'); });
    if (!addresses.length) throw new Error('Gateway DNS lookup returned no addresses');
    if (signal.aborted) throw new Error('Gateway preflight interrupted');

    await report({ percent: 50, stage: 'working', message: 'Verifying trusted TLS on port 443' });
    await this.dependencies.verifyTls(gatewayHostname, signal);
    if (signal.aborted) throw new Error('Gateway preflight interrupted');

    await report({ percent: 80, stage: 'verifying', message: 'Checking private Caddy adapter readiness' });
    await this.dependencies.verifyCaddy(signal);

    await report({ percent: 95, stage: 'verifying', message: 'Gateway DNS, TLS and adapter are ready' });
  }
}
