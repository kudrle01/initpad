import assert from 'node:assert/strict';
import { chmod, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  loadConfig,
  normalizeControlPlaneUrl,
  preflightConfigStorage,
  saveConfig,
} from './config.js';
import type { AgentConfig } from './types.js';

const CONFIG: AgentConfig = {
  controlPlaneUrl: 'https://initpad.example.test',
  agentId: 'agent-1',
  targetId: 'target-1',
  credential: `initpad_agent_${'a'.repeat(43)}`,
  credentialGeneration: 1,
  protocolVersion: 1,
  enrolledAt: '2026-08-10T12:00:00.000Z',
};

test('stores the credential atomically with root-only-style permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'initpad-agent-config-'));
  const path = join(root, 'nested', 'agent.json');
  await saveConfig(path, CONFIG);
  assert.deepEqual(await loadConfig(path), CONFIG);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, 'nested'))).mode & 0o777, 0o700);
});

test('never changes broad permissions on a custom parent directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'initpad-agent-parent-'));
  await chmod(root, 0o755);
  const path = join(root, 'agent.json');

  await assert.rejects(
    preflightConfigStorage(path),
    /directory permissions are too broad/,
  );
  assert.equal((await stat(root)).mode & 0o777, 0o755);
});

test('requires HTTPS unless insecure HTTP is explicit or loopback-only', () => {
  assert.equal(normalizeControlPlaneUrl('https://initpad.example.test/'), 'https://initpad.example.test');
  assert.equal(normalizeControlPlaneUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(
    normalizeControlPlaneUrl('http://host.docker.internal:8080', true),
    'http://host.docker.internal:8080',
  );
  assert.throws(
    () => normalizeControlPlaneUrl('http://initpad.example.test'),
    /HTTPS is required/,
  );
});
