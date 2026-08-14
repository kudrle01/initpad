import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CaddyAdminAdapter,
  GatewayPreflight,
  parseGatewayPreflightPayload,
} from './gateway-preflight.js';

test('accepts only a fixed Caddy preflight over a clean HTTPS DNS origin', () => {
  assert.deepEqual(parseGatewayPreflightPayload({
    adapter: 'caddy',
    publicUrl: 'https://Apps.Example.Test/',
  }), {
    adapter: 'caddy',
    publicUrl: 'https://apps.example.test',
  });
  assert.throws(
    () => parseGatewayPreflightPayload({
      adapter: 'caddy',
      publicUrl: 'https://apps.example.test',
      adminUrl: 'http://attacker.internal',
    }),
    /unsupported fields/,
  );
  assert.throws(
    () => parseGatewayPreflightPayload({ adapter: 'caddy', publicUrl: 'https://192.0.2.10' }),
    /HTTPS DNS origin/,
  );
});

test('checks DNS, trusted TLS and the local Caddy adapter in order', async () => {
  const calls: string[] = [];
  const progress: number[] = [];
  const preflight = new GatewayPreflight({
    resolve: async (hostname) => {
      calls.push(`dns:${hostname}`);
      return [{ address: '192.0.2.10', family: 4 }];
    },
    verifyTls: async (hostname) => { calls.push(`tls:${hostname}`); },
    verifyCaddy: async () => { calls.push('caddy'); },
  });

  await preflight.run(
    { adapter: 'caddy', publicUrl: 'https://apps.example.test' },
    new AbortController().signal,
    async (item) => { progress.push(item.percent); },
  );

  assert.deepEqual(calls, [
    'dns:initpad-preflight.apps.example.test',
    'tls:apps.example.test',
    'caddy',
  ]);
  assert.deepEqual(progress, [15, 50, 80, 95]);
});

test('refuses to contact a Caddy admin endpoint that resolves publicly', async () => {
  let contacted = false;
  const adapter = new CaddyAdminAdapter(
    'http://caddy.example.test:2019',
    async () => [{ address: '192.0.2.20', family: 4 }],
    async () => {
      contacted = true;
      return new Response('{}');
    },
  );

  await assert.rejects(
    adapter.ready(new AbortController().signal),
    /resolve only to private target addresses/,
  );
  assert.equal(contacted, false);
});

test('reads only the private Caddy configuration endpoint', async () => {
  let requested = '';
  const adapter = new CaddyAdminAdapter(
    'http://gateway.internal:2019',
    async () => [{ address: '172.20.0.4', family: 4 }],
    async (input) => {
      requested = input.toString();
      return new Response('{"apps":{}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );

  await adapter.ready(new AbortController().signal);
  assert.equal(requested, 'http://gateway.internal:2019/config/');
});
