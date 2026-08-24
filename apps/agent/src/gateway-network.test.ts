import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDockerNetwork } from './gateway-network.js';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';

const payload = {
  adapter: 'caddy',
  routeId: '123e4567-e89b-42d3-a456-426614174000',
  generation: 1,
  desiredState: 'active',
  hostname: 'portal-dev.example.test',
  allocationId: '223e4567-e89b-42d3-a456-426614174000',
  namespace: 'team-alpha',
  projectSlug: 'customer-portal',
  environment: 'dev',
  revision: 'abc123',
  containerPort: 8080,
} as const;

function response(statusCode: number, body: unknown = ''): DockerHttpResponse {
  return {
    statusCode,
    headers: {},
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function fakeEngine(input: { gatewayLabel?: string; targetId?: string } = {}) {
  const gatewayId = 'gateway-container-id';
  let connected = false;
  const requests: DockerHttpRequest[] = [];
  const transport: DockerTransport = async (request) => {
    requests.push(request);
    const path = decodeURIComponent(request.path);
    if (request.method === 'GET' && path === '/containers/initpad-gateway/json') {
      return response(200, {
        Id: gatewayId,
        Config: { Labels: { 'com.initpad.gateway': input.gatewayLabel ?? 'true' } },
        State: { Running: true },
      });
    }
    if (request.method === 'GET' && path === '/networks/net-team-alpha-customer-portal-dev') {
      return response(200, {
        Containers: connected ? { [gatewayId]: {} } : {},
        Labels: {
          'com.initpad.managed': 'true',
          'com.initpad.target': input.targetId ?? 'target-1',
          'com.initpad.allocation.id': payload.allocationId,
          'com.initpad.allocation.namespace': payload.namespace,
          'com.initpad.project': payload.projectSlug,
          'com.initpad.environment': payload.environment,
          'com.initpad.routing.mode': 'managed-gateway',
        },
      });
    }
    if (request.method === 'POST' && path.endsWith('/connect')) {
      connected = true;
      return response(200);
    }
    if (request.method === 'POST' && path.endsWith('/disconnect')) {
      connected = false;
      return response(200);
    }
    return response(500, { message: `Unhandled ${request.method} ${request.path}` });
  };
  return { transport, requests, connected: () => connected };
}

test('connects and disconnects only the configured gateway on the owned workload network', async () => {
  const engine = fakeEngine();
  const network = new GatewayDockerNetwork(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'initpad-gateway',
  );
  const signal = new AbortController().signal;

  await network.connect(payload, signal);
  assert.equal(engine.connected(), true);
  await network.connect(payload, signal);
  assert.equal(engine.requests.filter((request) => request.path.endsWith('/connect')).length, 1);

  await network.disconnect(payload, signal);
  assert.equal(engine.connected(), false);
  await network.disconnect(payload, signal);
  assert.equal(engine.requests.filter((request) => request.path.endsWith('/disconnect')).length, 1);
});

test('refuses a foreign gateway or allocation network without mutating Docker', async () => {
  const foreignGateway = fakeEngine({ gatewayLabel: 'false' });
  const signal = new AbortController().signal;
  await assert.rejects(
    new GatewayDockerNetwork(
      'target-1', 'tcp://docker:2375', foreignGateway.transport, 'initpad-gateway',
    ).connect(payload, signal),
    /not a running InitPad gateway/,
  );
  assert.equal(foreignGateway.requests.some((request) => request.method === 'POST'), false);

  const foreignNetwork = fakeEngine({ targetId: 'other-target' });
  await assert.rejects(
    new GatewayDockerNetwork(
      'target-1', 'tcp://docker:2375', foreignNetwork.transport, 'initpad-gateway',
    ).connect(payload, signal),
    /name collision outside allocation/,
  );
  assert.equal(foreignNetwork.requests.some((request) => request.method === 'POST'), false);
});
