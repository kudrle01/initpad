import { dockerError, dockerHttpRequest } from './docker-http.js';
import type { DockerHttpResponse, DockerTransport } from './docker-http.js';
import { workloadNetworkName } from './docker-lifecycle.js';
import type { GatewayRoutePayload } from './gateway-route.js';

const SAFE_CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

interface GatewayContainerInspect {
  Id: string;
  Config?: { Labels?: Record<string, string> };
  State?: { Running?: boolean };
}

interface WorkloadNetworkInspect {
  Containers?: Record<string, unknown>;
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
    (memberId) => memberId === containerId || memberId.startsWith(containerId) || containerId.startsWith(memberId),
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
      !gateway.Id
      || gateway.Config?.Labels?.['com.initpad.gateway'] !== 'true'
      || !gateway.State?.Running
    ) {
      throw new Error('Configured gateway container is not a running InitPad gateway');
    }
    return gateway;
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
      labels['com.initpad.managed'] !== 'true'
      || labels['com.initpad.target'] !== this.targetId
      || labels['com.initpad.allocation.id'] !== payload.allocationId
      || labels['com.initpad.allocation.namespace'] !== payload.namespace
      || labels['com.initpad.project'] !== payload.projectSlug
      || labels['com.initpad.environment'] !== payload.environment
      || labels['com.initpad.routing.mode'] !== 'managed-gateway'
    ) {
      throw new Error(`Docker network name collision outside allocation '${payload.allocationId}'`);
    }
    return { name, network };
  }

  private request(input: Parameters<DockerTransport>[0]): Promise<DockerHttpResponse> {
    return this.transport(input, this.dockerHost);
  }
}
