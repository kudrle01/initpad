import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileCredentialRotation } from './credential-rotation.js';
import type { AgentConfig, HeartbeatResponse } from './types.js';

function config(): AgentConfig {
  return {
    controlPlaneUrl: 'https://initpad.example.test',
    agentId: 'agent-1',
    targetId: 'target-1',
    credential: `initpad_agent_${'a'.repeat(43)}`,
    credentialGeneration: 1,
    protocolVersion: 1,
    enrolledAt: '2026-09-11T12:00:00.000Z',
  };
}

function response(overrides: Partial<HeartbeatResponse> = {}): HeartbeatResponse {
  return {
    targetId: 'target-1',
    credentialGeneration: 1,
    credentialConfirmed: true,
    acceptedAt: '2026-09-11T12:00:00.000Z',
    nextHeartbeatSeconds: 30,
    ...overrides,
  };
}

test('persists a pending credential before proving and promoting it', async () => {
  const current = config();
  const persisted: AgentConfig[] = [];
  const nextCredential = `initpad_agent_${'b'.repeat(43)}`;

  const result = await reconcileCredentialRotation(
    current,
    response({
      credentialRotation: { credential: nextCredential, credentialGeneration: 2 },
    }),
    async (value) => { persisted.push(structuredClone(value)); },
    async (value) => {
      assert.equal(value.credential, nextCredential);
      assert.equal(value.previousCredential, `initpad_agent_${'a'.repeat(43)}`);
      return response({ credentialGeneration: 2 });
    },
  );

  assert.equal(result.credentialGeneration, 2);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].previousCredential, `initpad_agent_${'a'.repeat(43)}`);
  assert.equal(persisted[1].previousCredential, undefined);
  assert.equal(current.credential, nextCredential);
  assert.equal(current.credentialGeneration, 2);
  assert.equal(current.previousCredential, undefined);
});

test('keeps the previous credential when confirmation fails', async () => {
  const current = config();
  const nextCredential = `initpad_agent_${'b'.repeat(43)}`;

  await assert.rejects(
    reconcileCredentialRotation(
      current,
      response({
        credentialRotation: { credential: nextCredential, credentialGeneration: 2 },
      }),
      async () => undefined,
      async () => { throw new Error('response lost'); },
    ),
    /response lost/,
  );
  assert.equal(current.credential, nextCredential);
  assert.equal(current.previousCredential, `initpad_agent_${'a'.repeat(43)}`);
});

test('clears a retained fallback after a later confirmation', async () => {
  const current = {
    ...config(),
    credential: `initpad_agent_${'b'.repeat(43)}`,
    credentialGeneration: 2,
    previousCredential: `initpad_agent_${'a'.repeat(43)}`,
    previousCredentialGeneration: 1,
  };
  let persisted: AgentConfig | undefined;

  await reconcileCredentialRotation(
    current,
    response({ credentialGeneration: 2 }),
    async (value) => { persisted = structuredClone(value); },
    async () => { throw new Error('not used'); },
  );

  assert.equal(persisted?.previousCredential, undefined);
  assert.equal(current.previousCredential, undefined);
});

test('rejects a skipped generation or malformed credential', async () => {
  const current = config();
  await assert.rejects(
    reconcileCredentialRotation(
      current,
      response({
        credentialRotation: { credential: 'invalid', credentialGeneration: 3 },
      }),
      async () => undefined,
      async () => response(),
    ),
    /invalid credential rotation/,
  );
});
