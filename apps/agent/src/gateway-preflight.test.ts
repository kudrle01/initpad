import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayPreflight, parseGatewayPreflightPayload } from './gateway-preflight.js';

test('accepts only a fixed Caddy preflight over a clean HTTPS DNS origin', () => {
  assert.deepEqual(
    parseGatewayPreflightPayload({
      adapter: 'caddy',
      publicUrl: 'https://Apps.Example.Test/',
    }),
    {
      adapter: 'caddy',
      publicUrl: 'https://apps.example.test',
    },
  );
  assert.throws(
    () =>
      parseGatewayPreflightPayload({
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
    verifyTls: async (hostname) => {
      calls.push(`tls:${hostname}`);
    },
    verifyCaddy: async () => {
      calls.push('caddy');
    },
  });

  await preflight.run(
    { adapter: 'caddy', publicUrl: 'https://apps.example.test' },
    new AbortController().signal,
    async (item) => {
      progress.push(item.percent);
    },
  );

  assert.deepEqual(calls, [
    'dns:initpad-preflight.apps.example.test',
    'tls:apps.example.test',
    'caddy',
  ]);
  assert.deepEqual(progress, [15, 50, 80, 95]);
});
