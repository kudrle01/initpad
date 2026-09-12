import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { CaddyAdminClient } from './caddy-admin.js';
import type { CaddyRouteSnapshot } from './caddy-admin.js';
import { GatewayDockerNetwork } from './gateway-network.js';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_NAMESPACE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const FIELDS = new Set([
  'adapter',
  'routeId',
  'generation',
  'desiredState',
  'hostname',
  'allocationId',
  'namespace',
  'projectSlug',
  'environment',
  'revision',
  'containerPort',
  'healthPath',
  'workloadSlot',
  'activation',
]);

export interface GatewayRoutePayload {
  adapter: 'caddy';
  routeId: string;
  generation: number;
  desiredState: 'active' | 'stopped' | 'absent';
  hostname: string;
  allocationId: string;
  namespace: string;
  projectSlug: string;
  environment: string;
  revision: string | null;
  containerPort: number;
  healthPath: string;
  workloadSlot: string | null;
  activation: 'deploy' | 'start' | null;
}

export interface GatewayRouteProgress {
  percent: number;
  stage: 'working' | 'verifying';
  message: string;
}

type ProgressReporter = (progress: GatewayRouteProgress) => Promise<void>;

interface GatewayRouteAdapter {
  reconcileRoute(
    intent: Parameters<CaddyAdminClient['reconcileRoute']>[0],
    signal: AbortSignal,
  ): Promise<void>;
  currentRoute(
    id: string,
    hostname: string,
    signal: AbortSignal,
  ): Promise<CaddyRouteSnapshot | null>;
}

interface GatewayNetworkAdapter {
  connect(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
  disconnect(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
  resolveUpstream(payload: GatewayRoutePayload, signal: AbortSignal): Promise<string>;
  commit(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
  rollback(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
}

interface PublicHealthAdapter {
  verify(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
}

export interface GatewayRouteRunResult {
  cleanupComplete: boolean;
}

export class PublicGatewayHealth implements PublicHealthAdapter {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly attempts = 20,
    private readonly retryMs = 500,
  ) {}

  async verify(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void> {
    const url = new URL(payload.healthPath, `https://${payload.hostname}`);
    let lastFailure = 'did not complete';
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      if (signal.aborted) throw new Error('Gateway public health verification was interrupted');
      try {
        const response = await this.request(url, {
          method: 'GET',
          headers: { accept: '*/*', 'user-agent': 'InitPad-Agent/0.8 gateway-health' },
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
        });
        await response.body?.cancel().catch(() => undefined);
        if (response.status >= 200 && response.status < 300) return;
        lastFailure = `returned HTTP ${response.status}`;
      } catch (error) {
        lastFailure = publicHealthFailure(error);
      }
      await sleep(this.retryMs, undefined, { signal }).catch(() => undefined);
    }
    const attemptLabel = `${this.attempts} ${this.attempts === 1 ? 'attempt' : 'attempts'}`;
    throw new Error(
      `Public HTTPS health check at ${payload.healthPath} ${lastFailure} after ${attemptLabel}`,
    );
  }
}

function publicHealthFailure(error: unknown): string {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const cause =
    record.cause && typeof record.cause === 'object'
      ? (record.cause as Record<string, unknown>)
      : {};
  const code = typeof cause.code === 'string' ? cause.code : '';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'failed because DNS lookup did not resolve';
  if (
    [
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ].includes(code)
  )
    return `failed TLS verification (${code})`;
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return `failed to connect (${code})`;
  }
  if (record.name === 'TimeoutError' || code === 'ETIMEDOUT') return 'timed out';
  return 'failed before receiving an HTTP response';
}

function required(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Gateway route payload contains an invalid ${name}`);
  }
  return value;
}

export function parseGatewayRoutePayload(value: unknown): GatewayRoutePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Gateway route payload is invalid');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((field) => !FIELDS.has(field))) {
    throw new Error('Gateway route payload contains unsupported fields');
  }
  if (
    input.adapter !== 'caddy' ||
    !['active', 'stopped', 'absent'].includes(String(input.desiredState))
  ) {
    throw new Error('Gateway route payload is invalid');
  }
  const hostname = required(input.hostname, 'hostname', /^[a-z0-9.-]{1,253}$/);
  if (isIP(hostname) || hostname.split('.').some((label) => !DNS_LABEL.test(label))) {
    throw new Error('Gateway route payload contains an invalid hostname');
  }
  const generation = input.generation;
  const containerPort = input.containerPort;
  if (
    typeof generation !== 'number' ||
    !Number.isInteger(generation) ||
    generation < 1 ||
    generation > 2_147_483_647
  ) {
    throw new Error('Gateway route payload contains an invalid generation');
  }
  if (
    typeof containerPort !== 'number' ||
    !Number.isInteger(containerPort) ||
    containerPort < 1 ||
    containerPort > 65_535
  ) {
    throw new Error('Gateway route payload contains an invalid container port');
  }
  const desiredState = input.desiredState as GatewayRoutePayload['desiredState'];
  const revision = input.revision === null ? null : required(input.revision, 'revision', REVISION);
  if (desiredState !== 'absent' && !revision) {
    throw new Error('Gateway route payload requires a revision for active or stopped state');
  }
  if (desiredState === 'absent' && revision !== null) {
    throw new Error('Gateway route payload cannot retain a revision when absent');
  }
  const healthPath = required(
    input.healthPath,
    'health path',
    /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$/,
  );
  const workloadSlot =
    input.workloadSlot === null
      ? null
      : required(input.workloadSlot, 'workload slot', /^[a-f0-9]{12}$/);
  const activation =
    input.activation === null
      ? null
      : required(input.activation, 'activation', /^(?:deploy|start)$/);
  if (desiredState === 'active') {
    if (!workloadSlot || !activation) {
      throw new Error(
        'Active gateway route payload requires a verified workload slot and activation',
      );
    }
  } else if (workloadSlot !== null || activation !== null) {
    throw new Error('Inactive gateway route payload cannot activate a workload slot');
  }
  return {
    adapter: 'caddy',
    routeId: required(input.routeId, 'route id', UUID),
    generation,
    desiredState,
    hostname,
    allocationId: required(input.allocationId, 'allocation id', UUID),
    namespace: required(input.namespace, 'namespace', SAFE_NAMESPACE),
    projectSlug: required(input.projectSlug, 'project slug', SAFE_ID),
    environment: required(input.environment, 'environment', SAFE_ID),
    revision,
    containerPort,
    healthPath,
    workloadSlot,
    activation: activation as GatewayRoutePayload['activation'],
  };
}

export class GatewayRouteReconciler {
  constructor(
    targetId: string,
    dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    private readonly caddy: GatewayRouteAdapter = new CaddyAdminClient(),
    private readonly network: GatewayNetworkAdapter = new GatewayDockerNetwork(
      targetId,
      dockerHost,
    ),
    private readonly publicHealth: PublicHealthAdapter = new PublicGatewayHealth(),
  ) {}

  async run(
    rawPayload: unknown,
    signal: AbortSignal,
    report: ProgressReporter,
  ): Promise<GatewayRouteRunResult> {
    const payload = parseGatewayRoutePayload(rawPayload);
    const routeId = `initpad_route_${payload.routeId.replaceAll('-', '')}`;
    await report({
      percent: 20,
      stage: 'working',
      message: 'Validated bounded gateway route intent',
    });
    if (payload.desiredState === 'active') {
      await report({
        percent: 40,
        stage: 'working',
        message: 'Connecting gateway to the owned workload network',
      });
      const previous = await this.caddy.currentRoute(routeId, payload.hostname, signal);
      let upstream: string | null = null;
      try {
        await this.network.connect(payload, signal);
        upstream = await this.network.resolveUpstream(payload, signal);
        await report({
          percent: 60,
          stage: 'working',
          message: 'Applying atomic Caddy route update',
        });
        await this.caddy.reconcileRoute(
          {
            id: routeId,
            hostname: payload.hostname,
            upstream,
            present: true,
          },
          signal,
        );
        await report({
          percent: 78,
          stage: 'verifying',
          message: 'Verifying the public HTTPS application path',
        });
        await this.publicHealth.verify(payload, signal);
      } catch (error) {
        await this.rollbackActivation(payload, routeId, previous, upstream, error);
      }
      await report({
        percent: 92,
        stage: 'working',
        message: 'Retiring the superseded workload revision',
      });
      let cleanupComplete = true;
      try {
        await this.network.commit(payload, signal);
      } catch {
        // The new route has already passed the public HTTPS gate. Reporting the
        // deployment as failed here would lie about which revision is serving
        // and could trigger an unsafe rollback after partial cleanup. A future
        // deploy or full project removal retries the ownership-bounded cleanup.
        cleanupComplete = false;
      }
      await report({
        percent: 97,
        stage: 'verifying',
        message: cleanupComplete
          ? 'Public HTTPS route is healthy and generation-fenced'
          : 'Public HTTPS route is healthy; superseded workload cleanup is pending',
      });
      return { cleanupComplete };
    }
    const previous = await this.caddy.currentRoute(routeId, payload.hostname, signal);
    try {
      await report({
        percent: 65,
        stage: 'working',
        message: 'Applying atomic Caddy route update',
      });
      await this.caddy.reconcileRoute(
        {
          id: routeId,
          hostname: payload.hostname,
          upstream: 'inactive.invalid:1',
          present: false,
        },
        signal,
      );
      await report({
        percent: 82,
        stage: 'working',
        message: 'Disconnecting gateway from the workload network',
      });
      await this.network.disconnect(payload, signal);
    } catch (error) {
      await this.restoreInactiveRoute(payload, routeId, previous, error);
    }
    await report({
      percent: 95,
      stage: 'verifying',
      message: 'Verified the fenced Caddy route generation',
    });
    return { cleanupComplete: true };
  }

  private async restoreInactiveRoute(
    payload: GatewayRoutePayload,
    routeId: string,
    previous: CaddyRouteSnapshot | null,
    cause: unknown,
  ): Promise<never> {
    const original = cause instanceof Error ? cause.message : 'Gateway deactivation failed';
    if (!previous)
      throw new Error(`${original}; rollback incomplete: previous route was not available`);
    try {
      await this.caddy.reconcileRoute(
        {
          id: routeId,
          hostname: payload.hostname,
          upstream: previous.upstream,
          present: true,
        },
        AbortSignal.timeout(15_000),
      );
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'route restore failed';
      throw new Error(`${original}; rollback incomplete: ${failure}`, { cause: error });
    }
    throw new Error(`${original}; previous serving route restored`);
  }

  private async rollbackActivation(
    payload: GatewayRoutePayload,
    routeId: string,
    previous: CaddyRouteSnapshot | null,
    attemptedUpstream: string | null,
    cause: unknown,
  ): Promise<never> {
    const rollbackSignal = AbortSignal.timeout(15_000);
    const failures: string[] = [];
    try {
      await this.caddy.reconcileRoute(
        {
          id: routeId,
          hostname: payload.hostname,
          upstream: previous?.upstream ?? attemptedUpstream ?? 'inactive.invalid:1',
          present: previous !== null,
        },
        rollbackSignal,
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'route restore failed');
    }
    if (!previous || previous.upstream !== attemptedUpstream) {
      try {
        await this.network.rollback(payload, rollbackSignal);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'workload rollback failed');
      }
    }
    if (!previous) {
      try {
        await this.network.disconnect(payload, rollbackSignal);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'gateway disconnect failed');
      }
    }
    const original = cause instanceof Error ? cause.message : 'Gateway activation failed';
    if (failures.length) {
      throw new Error(`${original}; rollback incomplete: ${failures.join('; ')}`);
    }
    throw new Error(
      `${original}; ${previous ? 'previous serving route restored' : 'previous gateway state restored'}`,
    );
  }
}
