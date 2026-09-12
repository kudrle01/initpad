import assert from 'node:assert/strict';
import test from 'node:test';
import { CaddyAdminClient } from './caddy-admin.js';

const signal = () => new AbortController().signal;
const privateResolver = async () => [{ address: '172.20.0.4', family: 4 }];
const route = {
  id: 'initpad_route_123e4567e89b42d3a456426614174000',
  hostname: 'portal-dev-a1b2c3d4e5f6.team.apps.example.test',
  upstream: 'initpad-team-portal-dev:8080',
  present: true,
};

function jsonResponse(body: unknown, status = 200, etag = '"config-1"'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', etag },
  });
}

test('refuses to contact a Caddy admin endpoint that resolves publicly', async () => {
  let contacted = false;
  const client = new CaddyAdminClient(
    'http://caddy.example.test:2019',
    async () => [{ address: '192.0.2.20', family: 4 }],
    async () => {
      contacted = true;
      return jsonResponse([]);
    },
  );
  await assert.rejects(client.ready(signal()), /resolve only to private target addresses/);
  assert.equal(contacted, false);
});

test('reads only the dedicated private Caddy route collection', async () => {
  let requested = '';
  const client = new CaddyAdminClient(
    'http://gateway.internal:2019',
    privateResolver,
    async (input) => {
      requested = input.toString();
      return jsonResponse([]);
    },
  );
  await client.ready(signal());
  assert.equal(requested, 'http://gateway.internal:2019/config/apps/http/servers/initpad/routes');
});

test('reads the admin API through a permissionable Unix socket without a TCP origin', async () => {
  let requested: { socket: string; path: string } | undefined;
  const client = new CaddyAdminClient(
    '',
    privateResolver,
    fetch,
    '/run/initpad-gateway/admin.sock',
    async (socket, path) => {
      requested = { socket, path };
      return jsonResponse([]);
    },
  );
  await client.ready(signal());
  assert.deepEqual(requested, {
    socket: '/run/initpad-gateway/admin.sock',
    path: '/config/apps/http/servers/initpad/routes',
  });
});

test('refuses ambiguous or unbounded Caddy admin socket configuration', async () => {
  await assert.rejects(
    new CaddyAdminClient(
      'http://gateway.internal:2019',
      privateResolver,
      fetch,
      '/run/initpad/admin.sock',
    ).ready(signal()),
    /either the Caddy admin Unix socket or URL/,
  );
  await assert.rejects(
    new CaddyAdminClient('', privateResolver, fetch, '/tmp/admin.sock').ready(signal()),
    /bounded path below \/run/,
  );
});

test('atomically adds and verifies a fixed reverse-proxy route with an ETag fence', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new CaddyAdminClient(
    'http://gateway.internal:2019',
    privateResolver,
    async (input, init) => {
      calls.push({ url: input.toString(), init });
      if (calls.length === 1) return jsonResponse([]);
      if (calls.length === 2) return jsonResponse({}, 200, '"config-2"');
      return jsonResponse(
        [
          {
            '@id': route.id,
            match: [{ host: [route.hostname] }],
            handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: route.upstream }] }],
            terminal: true,
          },
        ],
        200,
        '"config-2"',
      );
    },
  );

  await client.reconcileRoute(route, signal());

  assert.equal(calls[1]?.init?.method, 'PATCH');
  assert.equal(new Headers(calls[1]?.init?.headers).get('if-match'), '"config-1"');
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), [
    {
      '@id': route.id,
      match: [{ host: [route.hostname] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: route.upstream }] }],
      terminal: true,
    },
  ]);
});

test('treats Caddy canonical key ordering as an idempotent route', async () => {
  let calls = 0;
  const client = new CaddyAdminClient(
    'http://gateway.internal:2019',
    privateResolver,
    async (_input, init) => {
      calls += 1;
      assert.notEqual(init?.method, 'PATCH');
      return jsonResponse([
        {
          '@id': route.id,
          handle: [{ upstreams: [{ dial: route.upstream }], handler: 'reverse_proxy' }],
          match: [{ host: [route.hostname] }],
          terminal: true,
        },
      ]);
    },
  );
  await client.reconcileRoute(route, signal());
  assert.equal(calls, 1);
});

test('captures the exact previous owned upstream for health-gated rollback', async () => {
  const client = new CaddyAdminClient('http://gateway.internal:2019', privateResolver, async () =>
    jsonResponse([
      {
        '@id': route.id,
        handle: [{ upstreams: [{ dial: route.upstream }], handler: 'reverse_proxy' }],
        match: [{ host: [route.hostname] }],
        terminal: true,
      },
    ]),
  );
  assert.deepEqual(await client.currentRoute(route.id, route.hostname, signal()), {
    upstream: route.upstream,
  });
});

test('retries an ETag conflict without losing an unrelated Caddy route', async () => {
  const unrelated = { '@id': 'manual', handle: [{ handler: 'static_response', body: 'ok' }] };
  let request = 0;
  const patchedBodies: unknown[] = [];
  const client = new CaddyAdminClient(
    'http://gateway.internal:2019',
    privateResolver,
    async (_input, init) => {
      request += 1;
      if (init?.method === 'PATCH') {
        patchedBodies.push(JSON.parse(String(init.body)));
        if (patchedBodies.length === 1) return jsonResponse({}, 412);
        return jsonResponse({});
      }
      if (request === 1) return jsonResponse([]);
      return jsonResponse(
        [
          unrelated,
          ...(patchedBodies.length > 1
            ? [JSON.parse(JSON.stringify((patchedBodies[1] as unknown[])[1]))]
            : []),
        ],
        200,
        '"new"',
      );
    },
  );

  await client.reconcileRoute(route, signal());
  assert.equal(patchedBodies.length, 2);
  assert.deepEqual((patchedBodies[1] as unknown[])[0], unrelated);
});

test('removes only its owned route and refuses an identity collision', async () => {
  const managed = {
    '@id': route.id,
    match: [{ host: [route.hostname] }],
    handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: route.upstream }] }],
    terminal: true,
  };
  const unrelated = { '@id': 'manual', handle: [{ handler: 'static_response' }] };
  let patched: unknown;
  const removeClient = new CaddyAdminClient(
    'http://gateway.internal:2019',
    privateResolver,
    async (_input, init) => {
      if (init?.method === 'PATCH') {
        patched = JSON.parse(String(init.body));
        return jsonResponse({});
      }
      return jsonResponse(patched ?? [unrelated, managed]);
    },
  );
  await removeClient.reconcileRoute({ ...route, present: false }, signal());
  assert.deepEqual(patched, [unrelated]);

  const collisionClient = new CaddyAdminClient(
    'http://gateway.internal:2019',
    privateResolver,
    async () => jsonResponse([{ ...managed, match: [{ host: ['other.example.test'] }] }]),
  );
  await assert.rejects(collisionClient.reconcileRoute(route, signal()), /another hostname/);
});
