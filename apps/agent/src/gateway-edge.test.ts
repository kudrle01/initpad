import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';
import {
  GATEWAY_EDGE_CADDYFILE,
  GATEWAY_EDGE_CONFIG_LABEL,
  GatewayEdgeReconciler,
  gatewayEdgeConfigVersion,
} from './gateway-edge.js';

const image = `caddy:2.11-alpine@sha256:${'a'.repeat(64)}`;

function reply(statusCode: number, body: unknown = ''): DockerHttpResponse {
  return {
    statusCode,
    headers: {},
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function edge(overrides: Record<string, unknown> = {}, labels: Record<string, string> = {}) {
  return {
    Id: 'e'.repeat(64),
    Config: {
      Image: image,
      Env: ['GATEWAY_DOMAIN=apps.lab.local'],
      Labels: { 'com.initpad.gateway.installer': 'true', ...labels },
      ExposedPorts: { '80/tcp': {} },
    },
    HostConfig: { NetworkMode: 'initpad-gateway-net', ReadonlyRootfs: true },
    State: { Running: true },
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/lib/initpad-gateway/Caddyfile',
        Destination: '/etc/caddy/Caddyfile',
      },
    ],
    ...overrides,
  };
}

function fake(inspected: unknown, options: { failStart?: boolean } = {}) {
  const calls: DockerHttpRequest[] = [];
  let started = false;
  const transport: DockerTransport = (request) => {
    calls.push(request);
    const { method, path } = request;
    if (method === 'GET' && path === '/containers/initpad-gateway-edge/json') {
      return Promise.resolve(
        started && options.failStart
          ? reply(200, edge({ State: { Running: false } }))
          : reply(200, inspected),
      );
    }
    if (path.startsWith('/containers/create'))
      return Promise.resolve(reply(201, { Id: 'b'.repeat(64) }));
    if (path.endsWith('/wait?condition=not-running'))
      return Promise.resolve(reply(200, { StatusCode: 0 }));
    if (path.endsWith('/start')) {
      started = true;
      return Promise.resolve(reply(204));
    }
    if (method === 'GET') return Promise.resolve(reply(404, { message: 'no such container' }));
    return Promise.resolve(reply(204));
  };
  return { calls, transport };
}

const signal = new AbortController().signal;

test('the shipped edge Caddyfile matches the installer heredoc', () => {
  const installer = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  const match = /<<'EDGE'\n([\s\S]*?)\nEDGE\n/.exec(installer);
  assert.ok(match);
  assert.equal(`${match[1]}\n`, GATEWAY_EDGE_CADDYFILE);
});

test('does nothing without a managed edge', async () => {
  const { calls, transport } = fake(null);
  const result = await new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal);
  assert.equal(result.status, 'absent');
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
});

test('leaves an up-to-date edge alone', async () => {
  const version = gatewayEdgeConfigVersion();
  const { calls, transport } = fake(edge({}, { [GATEWAY_EDGE_CONFIG_LABEL]: version }));
  const result = await new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal);
  assert.deepEqual(result, { status: 'current', version });
  assert.equal(calls.length, 1);
});

test('ignores a container the installer did not create', async () => {
  const foreign = edge();
  (foreign.Config as { Labels: Record<string, string> }).Labels = {};
  const { calls, transport } = fake(foreign);
  const result = await new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal);
  assert.equal(result.status, 'absent');
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
});

test('refuses an edge whose state directory is not the installer one', async () => {
  const odd = edge({
    Mounts: [{ Type: 'bind', Source: '/etc/Caddyfile', Destination: '/etc/caddy/Caddyfile' }],
  });
  const { transport } = fake(odd);
  await assert.rejects(
    new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal),
    /state directory/,
  );
});

test('writes the new Caddyfile and recreates the edge with its own settings', async () => {
  const { calls, transport } = fake(edge());
  const result = await new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal);
  assert.equal(result.status, 'updated');

  const creates = calls.filter((call) => call.path.startsWith('/containers/create'));
  assert.equal(creates.length, 2);
  const helper = JSON.parse(String(creates[0]?.body)) as Record<string, unknown>;
  assert.equal(helper.Image, image);
  assert.deepEqual((helper.HostConfig as { Binds: string[] }).Binds, [
    '/var/lib/initpad-gateway:/state',
  ]);
  assert.equal((helper.HostConfig as { NetworkMode: string }).NetworkMode, 'none');
  assert.deepEqual(helper.Env, [`EDGE_CADDYFILE=${GATEWAY_EDGE_CADDYFILE}`]);

  const recreated = JSON.parse(String(creates[1]?.body)) as {
    Image: string;
    Labels: Record<string, string>;
    HostConfig: { ReadonlyRootfs: boolean };
  };
  assert.equal(recreated.Image, image);
  assert.equal(recreated.Labels[GATEWAY_EDGE_CONFIG_LABEL], gatewayEdgeConfigVersion());
  assert.equal(recreated.HostConfig.ReadonlyRootfs, true);
});

test('restores the previous edge and Caddyfile when the new edge does not stay up', async () => {
  const { calls, transport } = fake(edge(), { failStart: true });
  await assert.rejects(
    new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal),
    /did not stay running/,
  );
  const paths = calls.map((call) => call.path);
  assert.ok(
    paths.includes('/containers/initpad-gateway-edge-previous/rename?name=initpad-gateway-edge'),
  );
  const restore = calls
    .filter((call) => call.path.startsWith('/containers/create'))
    .map((call) => JSON.parse(String(call.body)) as { Cmd?: string[] })
    .filter((body) => body.Cmd?.[0]?.startsWith('mv -f'));
  assert.equal(restore.length, 1);
});

test('restores the previous edge even when the update was aborted mid-switch', async () => {
  const controller = new AbortController();
  const calls: DockerHttpRequest[] = [];
  const transport: DockerTransport = (request) => {
    calls.push(request);
    if (request.signal?.aborted) return Promise.reject(new Error('Docker API request aborted'));
    const { method, path } = request;
    if (method === 'GET' && path === '/containers/initpad-gateway-edge/json')
      return Promise.resolve(reply(200, edge()));
    if (path.startsWith('/containers/create')) {
      const body = JSON.parse(String(request.body)) as { Cmd?: string[] };
      // Abort right after the new edge container is created (Agent shutdown).
      if (!body.Cmd) controller.abort();
      return Promise.resolve(reply(201, { Id: 'b'.repeat(64) }));
    }
    if (path.endsWith('/wait?condition=not-running'))
      return Promise.resolve(reply(200, { StatusCode: 0 }));
    if (method === 'GET') return Promise.resolve(reply(404, { message: 'no such container' }));
    return Promise.resolve(reply(204));
  };
  await assert.rejects(
    new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(controller.signal),
  );
  const restored = calls.find(
    (call) =>
      call.path === '/containers/initpad-gateway-edge-previous/rename?name=initpad-gateway-edge',
  );
  assert.ok(restored, 'parked edge must be renamed back');
  assert.equal(restored.signal?.aborted, false);
  assert.ok(
    calls.some(
      (call) => call.path === '/containers/initpad-gateway-edge/start' && !call.signal?.aborted,
    ),
  );
});

test('puts back a parked edge left behind by a crash during an update', async () => {
  const calls: DockerHttpRequest[] = [];
  let restored = false;
  const version = gatewayEdgeConfigVersion();
  const transport: DockerTransport = (request) => {
    calls.push(request);
    const { method, path } = request;
    if (method === 'GET' && path === '/containers/initpad-gateway-edge/json')
      return Promise.resolve(
        restored
          ? reply(200, edge({}, { [GATEWAY_EDGE_CONFIG_LABEL]: version }))
          : reply(404, { message: 'no such container' }),
      );
    if (method === 'GET' && path === '/containers/initpad-gateway-edge-previous/json')
      return Promise.resolve(reply(200, edge()));
    if (path === '/containers/initpad-gateway-edge-previous/rename?name=initpad-gateway-edge') {
      restored = true;
      return Promise.resolve(reply(204));
    }
    if (path.startsWith('/containers/create'))
      return Promise.resolve(reply(201, { Id: 'b'.repeat(64) }));
    if (path.endsWith('/wait?condition=not-running'))
      return Promise.resolve(reply(200, { StatusCode: 0 }));
    if (method === 'GET') return Promise.resolve(reply(404, { message: 'no such container' }));
    return Promise.resolve(reply(204));
  };
  const result = await new GatewayEdgeReconciler('unix:///x', transport, 0).reconcile(signal);
  assert.deepEqual(result, { status: 'current', version });
  assert.ok(calls.some((call) => call.path === '/containers/initpad-gateway-edge/start'));
});
