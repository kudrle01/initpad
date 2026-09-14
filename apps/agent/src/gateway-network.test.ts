import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legacyWorkloadNetworkName,
  managedWorkloadContainerName,
  workloadNetworkName,
} from './docker-lifecycle.js';
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
  healthPath: '/health',
  workloadSlot: 'a1b2c3d4e5f6',
  activation: 'deploy',
} as const;

function response(statusCode: number, body: unknown = ''): DockerHttpResponse {
  return {
    statusCode,
    headers: {},
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function fakeEngine(
  input: { gatewayLabel?: string; targetId?: string; legacyNetwork?: boolean } = {},
) {
  const gatewayId = 'gateway-container-id';
  const scopedNetwork = workloadNetworkName({ ...payload, routingMode: 'managed-gateway' });
  const legacyNetwork = legacyWorkloadNetworkName({ ...payload, routingMode: 'managed-gateway' });
  const workloadId = 'managed-workload-id';
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
    if (request.method === 'GET' && request.path.startsWith('/containers/json?')) {
      return response(200, [
        {
          Id: workloadId,
          Names: [`/${managedWorkloadContainerName(payload, payload.workloadSlot)}`],
          Image: `registry.test/acme/customer-portal:${'a'.repeat(40)}`,
          State: 'running',
          Labels: {
            'com.initpad.managed': 'true',
            'com.initpad.target': 'target-1',
            'com.initpad.allocation.id': payload.allocationId,
            'com.initpad.allocation.namespace': payload.namespace,
            'com.initpad.project': payload.projectSlug,
            'com.initpad.environment': payload.environment,
            'com.initpad.workload': `${payload.allocationId}:${payload.projectSlug}:${payload.environment}`,
            'com.initpad.routing.mode': 'managed-gateway',
            'com.initpad.revision': payload.revision,
            'com.initpad.workload.slot': payload.workloadSlot,
          },
        },
      ]);
    }
    if (request.method === 'GET' && path === `/networks/${scopedNetwork}`) {
      if (input.legacyNetwork) return response(404);
      return response(200, {
        Containers: {
          [workloadId]: {},
          ...(connected ? { [gatewayId]: {} } : {}),
        },
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
    if (request.method === 'GET' && path === `/networks/${legacyNetwork}`) {
      if (!input.legacyNetwork) return response(404);
      return response(200, {
        Containers: {
          [workloadId]: {},
          ...(connected ? { [gatewayId]: {} } : {}),
        },
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

test('keeps an owned pre-allocation-scope gateway network operable during upgrade', async () => {
  const engine = fakeEngine({ legacyNetwork: true });
  const network = new GatewayDockerNetwork(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'initpad-gateway',
  );

  await network.connect(payload, new AbortController().signal);

  assert.equal(engine.connected(), true);
  assert.equal(
    engine.requests.some(
      (request) =>
        decodeURIComponent(request.path) === '/networks/net-team-alpha-customer-portal-dev',
    ),
    true,
  );
});

test('refuses a foreign gateway or allocation network without mutating Docker', async () => {
  const foreignGateway = fakeEngine({ gatewayLabel: 'false' });
  const signal = new AbortController().signal;
  await assert.rejects(
    new GatewayDockerNetwork(
      'target-1',
      'tcp://docker:2375',
      foreignGateway.transport,
      'initpad-gateway',
    ).connect(payload, signal),
    /not a running InitPad gateway/,
  );
  assert.equal(
    foreignGateway.requests.some((request) => request.method === 'POST'),
    false,
  );

  const foreignNetwork = fakeEngine({ targetId: 'other-target' });
  await assert.rejects(
    new GatewayDockerNetwork(
      'target-1',
      'tcp://docker:2375',
      foreignNetwork.transport,
      'initpad-gateway',
    ).connect(payload, signal),
    /name collision outside allocation/,
  );
  assert.equal(
    foreignNetwork.requests.some((request) => request.method === 'POST'),
    false,
  );
});

function publicationEngine() {
  const requests: DockerHttpRequest[] = [];
  const common = {
    'com.initpad.managed': 'true',
    'com.initpad.target': 'target-1',
    'com.initpad.allocation.id': payload.allocationId,
    'com.initpad.allocation.namespace': payload.namespace,
    'com.initpad.project': payload.projectSlug,
    'com.initpad.environment': payload.environment,
    'com.initpad.workload': `${payload.allocationId}:${payload.projectSlug}:${payload.environment}`,
    'com.initpad.routing.mode': 'managed-gateway',
  };
  const desired = {
    Id: 'desired-id',
    Names: ['/initpad-team-alpha-customer-portal-dev-rev-a1b2c3d4e5f6'],
    Image: `registry.test/acme/customer-portal:${'a'.repeat(40)}`,
    State: 'running',
    Labels: {
      ...common,
      'com.initpad.revision': payload.revision,
      'com.initpad.workload.slot': payload.workloadSlot,
    },
  };
  const previous = {
    Id: 'previous-id',
    Names: ['/initpad-team-alpha-customer-portal-dev-rev-111111111111'],
    Image: `registry.test/acme/customer-portal:${'b'.repeat(40)}`,
    State: 'running',
    Labels: {
      ...common,
      'com.initpad.revision': 'previous',
      'com.initpad.workload.slot': '111111111111',
    },
  };
  const transport: DockerTransport = async (request) => {
    requests.push(request);
    if (request.method === 'GET' && request.path.startsWith('/containers/json?')) {
      return response(200, [desired, previous]);
    }
    if (request.method === 'DELETE' && request.path.startsWith('/containers/'))
      return response(204);
    if (request.method === 'DELETE' && request.path.startsWith('/images/'))
      return response(200, []);
    if (request.method === 'POST' && request.path.includes('/stop?t=10')) return response(204);
    return response(500, { message: `Unhandled ${request.method} ${request.path}` });
  };
  return { transport, requests };
}

test('publishes only the verified workload slot and retires the previous revision afterwards', async () => {
  const engine = publicationEngine();
  const network = new GatewayDockerNetwork(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'initpad-gateway',
  );
  const signal = new AbortController().signal;

  assert.equal(
    await network.resolveUpstream(payload, signal),
    'initpad-team-alpha-customer-portal-dev-rev-a1b2c3d4e5f6:8080',
  );
  await network.commit(payload, signal);

  const containerDeletes = engine.requests.filter(
    (request) => request.method === 'DELETE' && request.path.startsWith('/containers/'),
  );
  const imageDeletes = engine.requests.filter(
    (request) => request.method === 'DELETE' && request.path.startsWith('/images/'),
  );
  assert.equal(containerDeletes.length, 1);
  assert.match(containerDeletes[0].path, /previous-id/);
  assert.equal(imageDeletes.length, 1);
  assert.match(decodeURIComponent(imageDeletes[0].path), /customer-portal:b{40}/);
});

test('discards only the failed candidate during route rollback', async () => {
  const engine = publicationEngine();
  const network = new GatewayDockerNetwork(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'initpad-gateway',
  );
  await network.rollback(payload, new AbortController().signal);

  const deletes = engine.requests.filter(
    (request) => request.method === 'DELETE' && request.path.startsWith('/containers/'),
  );
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].path, /desired-id/);
});
