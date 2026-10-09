import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { signRequest } from './auth.js';
import { createSupervisorServer } from './server.js';
import { loadState } from './state.js';
import type { PlatformReleaseManifest } from './types.js';

const secret = 's'.repeat(48);

function verifiedManifest(): PlatformReleaseManifest {
  const image = (component: string, letter: string) => ({
    name: `ghcr.io/example/initpad-${component}`,
    digest: `sha256:${letter.repeat(64)}`,
    immutableReference: `ghcr.io/example/initpad-${component}@sha256:${letter.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  });
  return {
    schemaVersion: 1,
    component: 'initpad-platform',
    version: '0.3.0',
    source: {
      repository: 'https://github.com/example/initpad',
      tag: 'initpad-v0.3.0',
      commit: 'd'.repeat(40),
    },
    images: {
      api: image('api', 'a'),
      web: image('web', 'b'),
      supervisor: image('supervisor', 'c'),
    },
    compose: { file: 'initpad-release.override.yml', sha256: 'e'.repeat(64) },
    database: {
      migrationMode: 'expand-contract',
      rollback: 'image-compatible',
      backupRequired: true,
    },
  };
}

function headers(
  method: string,
  path: string,
  requestId: string,
  body: Buffer,
): Record<string, string> {
  const timestamp = String(Date.now());
  return {
    'content-type': 'application/json',
    'x-initpad-timestamp': timestamp,
    'x-initpad-request-id': requestId,
    'x-initpad-signature-v2': signRequest(secret, method, path, timestamp, requestId, body),
  };
}

test('exposes only authenticated status/update endpoints and keeps requests idempotent', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'initpad-supervisor-server-'));
  process.env.INITPAD_SUPERVISOR_STATE_DIR = directory;
  process.env.INITPAD_PLATFORM_VERSION = '0.2.0';
  const launches: string[] = [];
  const server = createSupervisorServer(
    secret,
    { launchHelper: async (path) => void launches.push(path) },
    (async () => verifiedManifest()) as never,
  );
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('the execution sandbox does not permit loopback listeners');
      await rm(directory, { recursive: true, force: true });
      return;
    }
    throw error;
  }
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/status`)).status, 401);

    const statusId = '3f04ebec-3299-4ce5-bd02-cf390ca413e9';
    const statusBody = Buffer.alloc(0);
    const status = await fetch(`${base}/v1/status`, {
      headers: headers('GET', '/v1/status', statusId, statusBody),
    });
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as { currentVersion: string }).currentVersion, '0.2.0');

    const updateId = '8617bbb8-896d-46bb-9db7-afdc081b2b91';
    const updateBody = Buffer.from(
      JSON.stringify({ version: '0.3.0', manifestBase64: 'e30=', bundle: {} }),
    );
    const first = await fetch(`${base}/v1/update`, {
      method: 'POST',
      headers: headers('POST', '/v1/update', updateId, updateBody),
      body: updateBody,
    });
    assert.equal(first.status, 202);
    const second = await fetch(`${base}/v1/update`, {
      method: 'POST',
      headers: headers('POST', '/v1/update', updateId, updateBody),
      body: updateBody,
    });
    assert.equal(second.status, 200);
    assert.equal(launches.length, 1);

    // A status signature does not authorize an update, and the v1 header
    // alone is no longer accepted.
    const replayed = await fetch(`${base}/v1/update`, {
      method: 'POST',
      headers: headers('GET', '/v1/status', '6e1b3a3c-6f2e-4f33-9a52-0d6b8f1c2a10', updateBody),
      body: updateBody,
    });
    assert.equal(replayed.status, 401);
    const legacy = headers(
      'POST',
      '/v1/update',
      '7c2d4b4d-7a3f-4a44-8b63-1e7c9a2d3b21',
      updateBody,
    );
    legacy['x-initpad-signature'] = legacy['x-initpad-signature-v2'];
    delete legacy['x-initpad-signature-v2'];
    const legacyOnly = await fetch(`${base}/v1/update`, {
      method: 'POST',
      headers: legacy,
      body: updateBody,
    });
    assert.equal(legacyOnly.status, 401);
    assert.equal(launches.length, 1);
    assert.equal((await loadState()).operation?.requestId, updateId);
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
