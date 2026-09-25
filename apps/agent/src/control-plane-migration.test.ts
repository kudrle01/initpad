import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig, saveConfig } from './config.js';
import { migrateControlPlaneUrl } from './control-plane-migration.js';
import type { AgentConfig } from './types.js';

const CONFIG: AgentConfig = {
  controlPlaneUrl: 'https://old.initpad.example.test',
  agentId: 'agent-1',
  targetId: 'target-1',
  credential: `initpad_agent_${'a'.repeat(43)}`,
  credentialGeneration: 3,
  protocolVersion: 1,
  enrolledAt: '2026-09-25T09:00:00.000Z',
};

async function configPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'initpad-agent-url-'));
  const path = join(root, 'agent.json');
  await saveConfig(path, CONFIG);
  return path;
}

test('commits a new control-plane URL only after its heartbeat succeeds', async () => {
  const path = await configPath();
  let verified: AgentConfig | undefined;

  const result = await migrateControlPlaneUrl(
    path,
    'https://new.initpad.example.test/',
    false,
    async (candidate) => {
      verified = { ...candidate };
    },
  );

  assert.deepEqual(result, {
    changed: true,
    from: CONFIG.controlPlaneUrl,
    to: 'https://new.initpad.example.test',
  });
  assert.equal(verified?.controlPlaneUrl, 'https://new.initpad.example.test');
  assert.equal(verified?.credential, CONFIG.credential);
  assert.equal((await loadConfig(path)).controlPlaneUrl, 'https://new.initpad.example.test');
});

test('keeps the previous URL when the candidate endpoint rejects the heartbeat', async () => {
  const path = await configPath();

  await assert.rejects(
    migrateControlPlaneUrl(path, 'https://wrong.example.test', false, async () => {
      throw new Error('heartbeat rejected');
    }),
    /heartbeat rejected/,
  );

  assert.deepEqual(await loadConfig(path), CONFIG);
});

test('does not contact the control plane when the normalized URL is unchanged', async () => {
  const path = await configPath();
  let calls = 0;

  const result = await migrateControlPlaneUrl(
    path,
    `${CONFIG.controlPlaneUrl}/`,
    false,
    async () => {
      calls += 1;
    },
  );

  assert.equal(result.changed, false);
  assert.equal(calls, 0);
  assert.deepEqual(await loadConfig(path), CONFIG);
});
