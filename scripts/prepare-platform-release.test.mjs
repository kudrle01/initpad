import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { preparePlatformRelease } from './prepare-platform-release.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const digest = (letter) => `sha256:${letter.repeat(64)}`;

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'initpad-platform-release-'));
  const outputDirectory = resolve(directory, 'release');
  const sboms = {};
  for (const component of ['api', 'web', 'supervisor']) {
    const path = resolve(directory, `${component}.json`);
    writeFileSync(path, JSON.stringify({ SPDXID: `SPDXRef-${component}` }));
    sboms[component] = path;
  }
  return { outputDirectory, sboms };
}

function options() {
  const { outputDirectory, sboms } = fixture();
  return {
    root,
    outputDirectory,
    tag: 'initpad-v0.2.0',
    sourceCommit: 'd'.repeat(40),
    sourceRepository: 'https://github.com/kudrle01/initpad',
    images: {
      api: { name: 'ghcr.io/kudrle01/initpad-api', digest: digest('a') },
      web: { name: 'ghcr.io/kudrle01/initpad-web', digest: digest('b') },
      supervisor: { name: 'ghcr.io/kudrle01/initpad-supervisor', digest: digest('c') },
    },
    sboms,
  };
}

test('creates a deterministic signed-platform bundle input', () => {
  const input = options();
  const { manifest, override } = preparePlatformRelease(input);
  assert.equal(manifest.version, '0.2.0');
  assert.equal(
    manifest.images.api.immutableReference,
    `ghcr.io/kudrle01/initpad-api@${digest('a')}`,
  );
  assert.match(override, /INITPAD_PLATFORM_VERSION: "0\.2\.0"/);
  assert.equal(manifest.compose.sha256, createHash('sha256').update(override).digest('hex'));
  assert.equal(
    statSync(resolve(input.outputDirectory, 'initpad-install-release.sh')).mode & 0o777,
    0o755,
  );
  const installer = readFileSync(
    resolve(input.outputDirectory, 'initpad-install-release.sh'),
    'utf8',
  );
  assert.match(installer, /adopt-current-release --version "\$VERSION"/);
  assert.match(installer, /Release Compose descriptor does not match the signed manifest/);
  const checksums = readFileSync(resolve(input.outputDirectory, 'SHA256SUMS'), 'utf8');
  assert.match(checksums, /initpad-platform-release\.json/);
  assert.match(checksums, /initpad-supervisor-sbom\.json/);
});

test('rejects a mismatched tag, mutable image or foreign repository', () => {
  assert.throws(
    () => preparePlatformRelease({ ...options(), tag: 'initpad-v0.2.1' }),
    /release tag must be initpad-v0\.2\.0/,
  );
  const mutable = options();
  mutable.images.api.name = 'ghcr.io/kudrle01/initpad-api:latest';
  assert.throws(() => preparePlatformRelease(mutable), /must not contain a tag or digest/);
  assert.throws(
    () =>
      preparePlatformRelease({ ...options(), sourceRepository: 'https://github.com/evil/fork' }),
    /official InitPad repository/,
  );
});
