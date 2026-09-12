import { dockerError, dockerHttpRequest } from './docker-http.js';
import type { DockerHttpResponse, DockerTransport } from './docker-http.js';
import {
  managedWorkloadContainerName,
  workloadContainerName,
  workloadNetworkName,
} from './docker-lifecycle.js';
import type { GatewayRoutePayload } from './gateway-route.js';

const SAFE_CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const SAFE_PROJECT_IMAGE_REF = /^[a-z0-9][a-z0-9._:/-]{0,254}:[a-z0-9_][a-z0-9._-]{0,127}$/;

interface GatewayContainerInspect {
  Id: string;
  Config?: { Labels?: Record<string, string> };
  State?: { Running?: boolean };
}

interface WorkloadNetworkInspect {
  Containers?: Record<string, unknown>;
  Labels?: Record<string, string>;
}

interface ManagedWorkloadInspect {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Labels?: Record<string, string>;
}

function responseJson<T>(response: DockerHttpResponse, action: string): T {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw dockerError(response, action);
  }
  try {
    return JSON.parse(response.body.toString('utf8')) as T;
  } catch {
    throw new Error(`Docker API ${action} returned invalid JSON`);
  }
}

function containsContainer(network: WorkloadNetworkInspect, containerId: string): boolean {
  return Object.keys(network.Containers ?? {}).some(
    (memberId) =>
      memberId === containerId ||
      memberId.startsWith(containerId) ||
      containerId.startsWith(memberId),
  );
}

/**
 * Connects only the operator-configured gateway container to the exact
 * InitPad-owned workload network. It never creates, starts or replaces the
 * gateway and the declarative project payload cannot select another container.
 */
export class GatewayDockerNetwork {
  private readonly gatewayContainer: string;

  constructor(
    private readonly targetId: string,
    private readonly dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    private readonly transport: DockerTransport = dockerHttpRequest,
    gatewayContainer = process.env.INITPAD_AGENT_GATEWAY_CONTAINER ?? '',
  ) {
    this.gatewayContainer = gatewayContainer.trim();
  }

  async connect(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void> {
    const gateway = await this.inspectGateway(signal);
    const { name, network } = await this.inspectOwnedNetwork(payload, signal);
    if (containsContainer(network, gateway.Id)) return;
    const response = await this.request({
      method: 'POST',
      path: `/networks/${encodeURIComponent(name)}/connect`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Container: gateway.Id }),
      signal,
    });
    if (response.statusCode !== 200 && response.statusCode !== 403) {
      throw dockerError(response, 'connect gateway to workload network');
    }
    const verified = await this.inspectOwnedNetwork(payload, signal);
    if (!containsContainer(verified.network, gateway.Id)) {
      throw new Error('Docker did not connect the configured gateway to the workload network');
    }
  }

  async disconnect(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void> {
    const gateway = await this.inspectGateway(signal);
    const { name, network } = await this.inspectOwnedNetwork(payload, signal);
    if (!containsContainer(network, gateway.Id)) return;
    const response = await this.request({
      method: 'POST',
      path: `/networks/${encodeURIComponent(name)}/disconnect`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Container: gateway.Id, Force: false }),
      signal,
    });
    if (response.statusCode !== 200 && response.statusCode !== 403) {
      throw dockerError(response, 'disconnect gateway from workload network');
    }
    const verified = await this.inspectOwnedNetwork(payload, signal);
    if (containsContainer(verified.network, gateway.Id)) {
      throw new Error('Docker did not disconnect the configured gateway from the workload network');
    }
  }

  async resolveUpstream(payload: GatewayRoutePayload, signal: AbortSignal): Promise<string> {
    const workload = await this.activeWorkload(payload, signal);
    return `${this.containerName(workload)}:${payload.containerPort}`;
  }

  async commit(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void> {
    if (payload.activation !== 'deploy') return;
    const active = await this.activeWorkload(payload, signal);
    const workloads = await this.ownedWorkloads(payload, signal);
    for (const workload of workloads) {
      if (workload.Id === active.Id) continue;
      // Publication already passed through the real HTTPS hostname. Old
      // revisions are now safe to remove; cleanup never runs before that gate.
      const response = await this.request({
        method: 'DELETE',
        path: `/containers/${encodeURIComponent(workload.Id)}?force=1&v=1`,
        signal,
      });
      if (![204, 404].includes(response.statusCode)) {
        throw dockerError(response, 'remove superseded managed workload');
      }
      if (typeof workload.Image === 'string' && SAFE_PROJECT_IMAGE_REF.test(workload.Image)) {
        const image = await this.request({
          method: 'DELETE',
          path: `/images/${encodeURIComponent(workload.Image)}?force=false&noprune=false`,
          signal,
        });
        // 409 means another environment still uses the build-once image.
        if (![200, 404, 409].includes(image.statusCode)) {
          throw dockerError(image, 'remove superseded managed image');
        }
      }
    }
  }

  async rollback(payload: GatewayRoutePayload, signal: AbortSignal): Promise<void> {
    const active = await this.activeWorkload(payload, signal);
    if (payload.activation === 'deploy') {
      const response = await this.request({
        method: 'DELETE',
        path: `/containers/${encodeURIComponent(active.Id)}?force=1&v=1`,
        signal,
      });
      if (![204, 404].includes(response.statusCode)) {
        throw dockerError(response, 'discard failed managed workload');
      }
      return;
    }
    if (payload.activation === 'start') {
      const response = await this.request({
        method: 'POST',
        path: `/containers/${encodeURIComponent(active.Id)}/stop?t=10`,
        signal,
      });
      if (![204, 304].includes(response.statusCode)) {
        throw dockerError(response, 'restore stopped managed workload');
      }
    }
  }

  private async inspectGateway(signal: AbortSignal): Promise<GatewayContainerInspect> {
    if (!SAFE_CONTAINER_NAME.test(this.gatewayContainer)) {
      throw new Error('INITPAD_AGENT_GATEWAY_CONTAINER must name one local gateway container');
    }
    const response = await this.request({
      method: 'GET',
      path: `/containers/${encodeURIComponent(this.gatewayContainer)}/json`,
      signal,
    });
    const gateway = responseJson<GatewayContainerInspect>(response, 'inspect configured gateway');
    if (
      !gateway.Id ||
      gateway.Config?.Labels?.['com.initpad.gateway'] !== 'true' ||
      !gateway.State?.Running
    ) {
      throw new Error('Configured gateway container is not a running InitPad gateway');
    }
    return gateway;
  }

  private async activeWorkload(
    payload: GatewayRoutePayload,
    signal: AbortSignal,
  ): Promise<ManagedWorkloadInspect> {
    if (!payload.workloadSlot || !payload.revision) {
      throw new Error('Active managed route has no workload identity');
    }
    const expected = managedWorkloadContainerName(payload, payload.workloadSlot);
    const legacy = workloadContainerName(payload);
    const matches = (await this.ownedWorkloads(payload, signal)).filter((container) => {
      const labels = container.Labels ?? {};
      const name = this.containerName(container);
      return (
        container.State === 'running' &&
        labels['com.initpad.revision'] === payload.revision &&
        ((name === expected && labels['com.initpad.workload.slot'] === payload.workloadSlot) ||
          (name === legacy && labels['com.initpad.workload.slot'] === undefined))
      );
    });
    if (matches.length !== 1) {
      throw new Error('Managed gateway could not identify exactly one healthy workload revision');
    }
    return matches[0];
  }

  private async ownedWorkloads(
    payload: GatewayRoutePayload,
    signal: AbortSignal,
  ): Promise<ManagedWorkloadInspect[]> {
    const workloadKey = `${payload.allocationId}:${payload.projectSlug}:${payload.environment}`;
    const filters = encodeURIComponent(
      JSON.stringify({
        label: [
          'com.initpad.managed=true',
          `com.initpad.target=${this.targetId}`,
          `com.initpad.allocation.id=${payload.allocationId}`,
          `com.initpad.workload=${workloadKey}`,
          'com.initpad.routing.mode=managed-gateway',
        ],
      }),
    );
    const response = await this.request({
      method: 'GET',
      path: `/containers/json?all=1&filters=${filters}`,
      signal,
    });
    const containers = responseJson<ManagedWorkloadInspect[]>(response, 'list managed workloads');
    if (!Array.isArray(containers) || containers.length > 256) {
      throw new Error('Docker returned an invalid managed workload list');
    }
    for (const container of containers) {
      const labels = container.Labels ?? {};
      if (
        !container.Id ||
        labels['com.initpad.managed'] !== 'true' ||
        labels['com.initpad.target'] !== this.targetId ||
        labels['com.initpad.allocation.id'] !== payload.allocationId ||
        labels['com.initpad.allocation.namespace'] !== payload.namespace ||
        labels['com.initpad.project'] !== payload.projectSlug ||
        labels['com.initpad.environment'] !== payload.environment ||
        labels['com.initpad.workload'] !== workloadKey ||
        labels['com.initpad.routing.mode'] !== 'managed-gateway'
      ) {
        throw new Error('Docker returned a workload outside the managed route allocation');
      }
      this.containerName(container);
    }
    return containers;
  }

  private containerName(container: ManagedWorkloadInspect): string {
    const names = container.Names ?? [];
    if (names.length !== 1 || !/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(names[0])) {
      throw new Error('Managed workload has an invalid Docker name');
    }
    return names[0].slice(1);
  }

  private async inspectOwnedNetwork(
    payload: GatewayRoutePayload,
    signal: AbortSignal,
  ): Promise<{ name: string; network: WorkloadNetworkInspect }> {
    const name = workloadNetworkName({ ...payload, routingMode: 'managed-gateway' });
    const response = await this.request({
      method: 'GET',
      path: `/networks/${encodeURIComponent(name)}`,
      signal,
    });
    const network = responseJson<WorkloadNetworkInspect>(response, 'inspect workload network');
    const labels = network.Labels ?? {};
    if (
      labels['com.initpad.managed'] !== 'true' ||
      labels['com.initpad.target'] !== this.targetId ||
      labels['com.initpad.allocation.id'] !== payload.allocationId ||
      labels['com.initpad.allocation.namespace'] !== payload.namespace ||
      labels['com.initpad.project'] !== payload.projectSlug ||
      labels['com.initpad.environment'] !== payload.environment ||
      labels['com.initpad.routing.mode'] !== 'managed-gateway'
    ) {
      throw new Error(`Docker network name collision outside allocation '${payload.allocationId}'`);
    }
    return { name, network };
  }

  private request(input: Parameters<DockerTransport>[0]): Promise<DockerHttpResponse> {
    return this.transport(input, this.dockerHost);
  }
}
