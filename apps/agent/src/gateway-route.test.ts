import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { CaddyRouteIntent } from './caddy-admin.js';
import {
  GatewayRouteReconciler,
  PublicGatewayHealth,
  parseGatewayRoutePayload,
} from './gateway-route.js';

const payload = {
  adapter: 'caddy',
  routeId: '123e4567-e89b-42d3-a456-426614174000',
  generation: 3,
  desiredState: 'active',
  hostname: 'portal-dev-a1b2c3d4e5f6.team.apps.example.test',
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

test('accepts only a bounded declarative route intent', () => {
  assert.deepEqual(parseGatewayRoutePayload(payload), payload);
  assert.throws(
    () => parseGatewayRoutePayload({ ...payload, adminUrl: 'http://attacker' }),
    /unsupported fields/,
  );
  assert.throws(
    () => parseGatewayRoutePayload({ ...payload, upstream: 'attacker:80' }),
    /unsupported fields/,
  );
  assert.throws(
    () => parseGatewayRoutePayload({ ...payload, hostname: '127.0.0.1' }),
    /invalid hostname/,
  );
  assert.throws(
    () => parseGatewayRoutePayload({ ...payload, desiredState: 'stopped', revision: null }),
    /requires a revision/,
  );
});

test('retries the exact public HTTPS health path until it returns 2xx', async () => {
  const requests: string[] = [];
  const statuses = [503, 204];
  const health = new PublicGatewayHealth(async (input, init) => {
    requests.push(input.toString());
    assert.equal(init?.redirect, 'error');
    return new Response(null, { status: statuses.shift() });
  }, 2, 0);

  await health.verify(payload, new AbortController().signal);
  assert.deepEqual(requests, [
    `https://${payload.hostname}/health`,
    `https://${payload.hostname}/health`,
  ]);
});

test('reports the final bounded HTTP failure after exhausting public health retries', async () => {
  const health = new PublicGatewayHealth(async () => new Response(null, { status: 502 }), 2, 0);

  await assert.rejects(
    health.verify(payload, new AbortController().signal),
    /Public HTTPS health check at \/health returned HTTP 502 after 2 attempts/,
  );
});

test('classifies DNS failures without exposing an unbounded fetch error', async () => {
  const health = new PublicGatewayHealth(async () => {
    throw Object.assign(new TypeError('fetch failed for a sensitive internal URL'), {
      cause: Object.assign(new Error('resolver details'), { code: 'ENOTFOUND' }),
    });
  }, 1, 0);

  await assert.rejects(
    health.verify(payload, new AbortController().signal),
    /Public HTTPS health check at \/health failed because DNS lookup did not resolve after 1 attempt/,
  );
});

test('keeps automatic HTTPS disabled on the lab gateway behind the TLS edge', async () => {
  const config = JSON.parse(await readFile(
    new URL('../../../deploy/agent-lab-caddy.json', import.meta.url),
    'utf8',
  )) as {
    apps?: { http?: { servers?: { initpad?: { automatic_https?: { disable?: boolean } } } } };
  };

  assert.equal(config.apps?.http?.servers?.initpad?.automatic_https?.disable, true);

  const bootstrap = await readFile(
    new URL('../../../deploy/agent-lab-gateway-bootstrap.sh', import.meta.url),
    'utf8',
  );
  assert.match(bootstrap, /--volume "\$config_volume:\/config"/);
  assert.match(bootstrap, /caddy run --resume/);
  assert.match(bootstrap, /com\.initpad\.routing\.mode/);
  assert.match(bootstrap, /volume_sha/);
  assert.doesNotMatch(bootstrap, /--tmpfs \/config/);
});

test('derives the owned Caddy route and upstream from workload identity', async () => {
  let intent: CaddyRouteIntent | undefined;
  const progress: number[] = [];
  const actions: string[] = [];
  const reconciler = new GatewayRouteReconciler(
    'target-1',
    'unix:///var/run/docker.sock',
    {
      currentRoute: async () => { actions.push('current'); return null; },
      reconcileRoute: async (value) => { intent = value; actions.push('route'); },
    },
    {
      connect: async () => { actions.push('connect'); },
      disconnect: async () => { actions.push('disconnect'); },
      resolveUpstream: async () => { actions.push('resolve'); return 'owned-workload:8080'; },
      commit: async () => { actions.push('commit'); },
      rollback: async () => { actions.push('rollback'); },
    },
    { verify: async () => { actions.push('health'); } },
  );

  const result = await reconciler.run(payload, new AbortController().signal, async (item) => {
    progress.push(item.percent);
  });

  assert.deepEqual(intent, {
    id: 'initpad_route_123e4567e89b42d3a456426614174000',
    hostname: payload.hostname,
    upstream: 'owned-workload:8080',
    present: true,
  });
  assert.deepEqual(actions, ['current', 'connect', 'resolve', 'route', 'health', 'commit']);
  assert.deepEqual(progress, [20, 40, 60, 78, 92, 97]);
  assert.deepEqual(result, { cleanupComplete: true });
});

test('keeps a healthy cutover successful while exposing pending superseded cleanup', async () => {
  const messages: string[] = [];
  const reconciler = new GatewayRouteReconciler(
    'target-1',
    'unix:///var/run/docker.sock',
    {
      currentRoute: async () => ({ upstream: 'previous-revision:8080' }),
      reconcileRoute: async () => undefined,
    },
    {
      connect: async () => undefined,
      disconnect: async () => undefined,
      resolveUpstream: async () => 'candidate-revision:8080',
      commit: async () => { throw new Error('Docker is temporarily busy'); },
      rollback: async () => undefined,
    },
    { verify: async () => undefined },
  );

  const result = await reconciler.run(payload, new AbortController().signal, async (progress) => {
    messages.push(progress.message);
  });

  assert.deepEqual(result, { cleanupComplete: false });
  assert.match(messages.at(-1) ?? '', /cleanup is pending/);
});

test('stopped and absent desired states remove the owned route', async () => {
  const intents: CaddyRouteIntent[] = [];
  const actions: string[] = [];
  const reconciler = new GatewayRouteReconciler(
    'target-1',
    'unix:///var/run/docker.sock',
    {
      currentRoute: async () => null,
      reconcileRoute: async (value) => { intents.push(value); actions.push('route'); },
    },
    {
      connect: async () => { actions.push('connect'); },
      disconnect: async () => { actions.push('disconnect'); },
      resolveUpstream: async () => 'unused:1',
      commit: async () => undefined,
      rollback: async () => undefined,
    },
    { verify: async () => undefined },
  );
  await reconciler.run(
    { ...payload, desiredState: 'stopped', workloadSlot: null, activation: null },
    new AbortController().signal,
    async () => undefined,
  );
  await reconciler.run(
    { ...payload, desiredState: 'absent', revision: null, workloadSlot: null, activation: null },
    new AbortController().signal,
    async () => undefined,
  );
  assert.deepEqual(intents.map((intent) => intent.present), [false, false]);
  assert.deepEqual(actions, ['route', 'disconnect', 'route', 'disconnect']);
});

test('restores the serving route when gateway disconnect fails during teardown', async () => {
  const intents: CaddyRouteIntent[] = [];
  const reconciler = new GatewayRouteReconciler(
    'target-1',
    'unix:///var/run/docker.sock',
    {
      currentRoute: async () => ({ upstream: 'serving-revision:8080' }),
      reconcileRoute: async (intent) => { intents.push(intent); },
    },
    {
      connect: async () => undefined,
      disconnect: async () => { throw new Error('Docker network is busy'); },
      resolveUpstream: async () => 'unused:1',
      commit: async () => undefined,
      rollback: async () => undefined,
    },
    { verify: async () => undefined },
  );

  await assert.rejects(
    reconciler.run(
      { ...payload, desiredState: 'stopped', workloadSlot: null, activation: null },
      new AbortController().signal,
      async () => undefined,
    ),
    /previous serving route restored/,
  );
  assert.deepEqual(intents, [
    expectRoute(false, 'inactive.invalid:1'),
    expectRoute(true, 'serving-revision:8080'),
  ]);
});

test('restores the previous serving route when public HTTPS verification fails', async () => {
  const intents: CaddyRouteIntent[] = [];
  const actions: string[] = [];
  const reconciler = new GatewayRouteReconciler(
    'target-1',
    'unix:///var/run/docker.sock',
    {
      currentRoute: async () => ({ upstream: 'previous-revision:8080' }),
      reconcileRoute: async (intent) => { intents.push(intent); actions.push(`route:${intent.upstream}`); },
    },
    {
      connect: async () => { actions.push('connect'); },
      disconnect: async () => { actions.push('disconnect'); },
      resolveUpstream: async () => 'candidate-revision:8080',
      commit: async () => { actions.push('commit'); },
      rollback: async () => { actions.push('rollback'); },
    },
    { verify: async () => { throw new Error('Public HTTPS returned 500'); } },
  );

  await assert.rejects(
    reconciler.run(payload, new AbortController().signal, async () => undefined),
    /previous serving route restored/,
  );
  assert.deepEqual(intents.map((intent) => intent.upstream), [
    'candidate-revision:8080',
    'previous-revision:8080',
  ]);
  assert.deepEqual(actions, [
    'connect',
    'route:candidate-revision:8080',
    'route:previous-revision:8080',
    'rollback',
  ]);
});

test('removes a failed first route and disconnects the gateway', async () => {
  const intents: CaddyRouteIntent[] = [];
  const actions: string[] = [];
  const reconciler = new GatewayRouteReconciler(
    'target-1',
    'unix:///var/run/docker.sock',
    {
      currentRoute: async () => null,
      reconcileRoute: async (intent) => { intents.push(intent); },
    },
    {
      connect: async () => undefined,
      disconnect: async () => { actions.push('disconnect'); },
      resolveUpstream: async () => 'first-revision:8080',
      commit: async () => undefined,
      rollback: async () => { actions.push('discard'); },
    },
    { verify: async () => { throw new Error('TLS verification failed'); } },
  );

  await assert.rejects(
    reconciler.run(payload, new AbortController().signal, async () => undefined),
    /previous gateway state restored/,
  );
  assert.deepEqual(intents.map((intent) => intent.present), [true, false]);
  assert.deepEqual(actions, ['discard', 'disconnect']);
});

function expectRoute(present: boolean, upstream: string): CaddyRouteIntent {
  return {
    id: 'initpad_route_123e4567e89b42d3a456426614174000',
    hostname: payload.hostname,
    upstream,
    present,
  };
}
