import { isIP } from 'node:net';
import { CaddyAdminClient } from './caddy-admin.js';
import { GatewayDockerNetwork } from './gateway-network.js';
import { workloadContainerName } from './docker-lifecycle.js';

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
}

export interface GatewayRouteProgress {
  percent: number;
  stage: 'working' | 'verifying';
  message: string;
}

type ProgressReporter = (progress: GatewayRouteProgress) => Promise<void>;

interface GatewayRouteAdapter {
  reconcileRoute(intent: Parameters<CaddyAdminClient['reconcileRoute']>[0], signal: AbortSignal): Promise<void>;
}

interface GatewayNetworkAdapter {
  connect(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
  disconnect(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void>;
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
  if (input.adapter !== 'caddy' || !['active', 'stopped', 'absent'].includes(String(input.desiredState))) {
    throw new Error('Gateway route payload is invalid');
  }
  const hostname = required(input.hostname, 'hostname', /^[a-z0-9.-]{1,253}$/);
  if (isIP(hostname) || hostname.split('.').some((label) => !DNS_LABEL.test(label))) {
    throw new Error('Gateway route payload contains an invalid hostname');
  }
  const generation = input.generation;
  const containerPort = input.containerPort;
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1 || generation > 2_147_483_647) {
    throw new Error('Gateway route payload contains an invalid generation');
  }
  if (typeof containerPort !== 'number' || !Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65_535) {
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
  };
}

export class GatewayRouteReconciler {
  constructor(
    targetId: string,
    dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    private readonly caddy: GatewayRouteAdapter = new CaddyAdminClient(),
    private readonly network: GatewayNetworkAdapter = new GatewayDockerNetwork(targetId, dockerHost),
  ) {}

  async run(rawPayload: unknown, signal: AbortSignal, report: ProgressReporter): Promise<void> {
    const payload = parseGatewayRoutePayload(rawPayload);
    const container = workloadContainerName(payload);
    await report({ percent: 20, stage: 'working', message: 'Validated bounded gateway route intent' });
    if (payload.desiredState === 'active') {
      await report({ percent: 40, stage: 'working', message: 'Connecting gateway to the owned workload network' });
      await this.network.connect(payload, signal);
    }
    await report({ percent: 65, stage: 'working', message: 'Applying atomic Caddy route update' });
    await this.caddy.reconcileRoute({
      id: `initpad_route_${payload.routeId.replaceAll('-', '')}`,
      hostname: payload.hostname,
      upstream: `${container}:${payload.containerPort}`,
      present: payload.desiredState === 'active',
    }, signal);
    if (payload.desiredState !== 'active') {
      await report({ percent: 82, stage: 'working', message: 'Disconnecting gateway from the workload network' });
      await this.network.disconnect(payload, signal);
    }
    await report({ percent: 95, stage: 'verifying', message: 'Verified the fenced Caddy route generation' });
  }
}
