import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaddyRouteIntent } from './caddy-admin.js';
import { GatewayRouteReconciler, parseGatewayRoutePayload } from './gateway-route.js';

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

test('derives the owned Caddy route and upstream from workload identity', async () => {
  let intent: CaddyRouteIntent | undefined;
  const progress: number[] = [];
  const reconciler = new GatewayRouteReconciler({
    reconcileRoute: async (value) => { intent = value; },
  });

  await reconciler.run(payload, new AbortController().signal, async (item) => {
    progress.push(item.percent);
  });

  assert.deepEqual(intent, {
    id: 'initpad_route_123e4567e89b42d3a456426614174000',
    hostname: payload.hostname,
    upstream: 'initpad-team-alpha-customer-portal-dev:8080',
    present: true,
  });
  assert.deepEqual(progress, [20, 60, 95]);
});

test('stopped and absent desired states remove the owned route', async () => {
  const intents: CaddyRouteIntent[] = [];
  const reconciler = new GatewayRouteReconciler({
    reconcileRoute: async (value) => { intents.push(value); },
  });
  await reconciler.run({ ...payload, desiredState: 'stopped' }, new AbortController().signal, async () => undefined);
  await reconciler.run({ ...payload, desiredState: 'absent', revision: null }, new AbortController().signal, async () => undefined);
  assert.deepEqual(intents.map((intent) => intent.present), [false, false]);
});
