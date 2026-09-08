import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { prepareAgentRelease } from './prepare-agent-release.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const digest = `sha256:${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'initpad-agent-release-'));
  const sbomPath = resolve(directory, 'source-sbom.json');
  const outputDirectory = resolve(directory, 'release');
  writeFileSync(sbomPath, JSON.stringify({ SPDX: { SPDXID: 'SPDXRef-DOCUMENT' } }));
  return { outputDirectory, sbomPath };
}

test('creates a deterministic digest-bound Agent release bundle', () => {
  const { outputDirectory, sbomPath } = fixture();
  const { manifest } = prepareAgentRelease({
    root,
    outputDirectory,
    tag: 'agent-v0.9.0',
    image: 'ghcr.io/example/initpad-agent',
    digest,
    sourceCommit: commit,
    sourceRepository: 'https://github.com/example/initpad',
    sbomPath,
  });

  assert.equal(manifest.image.immutableReference, `ghcr.io/example/initpad-agent@${digest}`);
  assert.deepEqual(manifest.image.platforms, ['linux/amd64', 'linux/arm64']);
  assert.equal(statSync(resolve(outputDirectory, 'initpad-agent-install.sh')).mode & 0o777, 0o755);

  const checksumLines = readFileSync(resolve(outputDirectory, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n');
  assert.deepEqual(
    checksumLines.map((line) => line.split('  ')[1]),
    ['initpad-agent-install.sh', 'initpad-agent-release.json', 'initpad-agent-sbom.json'],
  );
  for (const line of checksumLines) {
    const [expected, name] = line.split('  ');
    const actual = createHash('sha256')
      .update(readFileSync(resolve(outputDirectory, name)))
      .digest('hex');
    assert.equal(actual, expected);
  }
});

test('rejects a tag which does not exactly match the Agent package version', () => {
  const { outputDirectory, sbomPath } = fixture();
  assert.throws(
    () =>
      prepareAgentRelease({
        root,
        outputDirectory,
        tag: 'agent-v0.9.1',
        image: 'ghcr.io/example/initpad-agent',
        digest,
        sourceCommit: commit,
        sourceRepository: 'https://github.com/example/initpad',
        sbomPath,
      }),
    /release tag must be agent-v0\.9\.0/,
  );
});

test('rejects mutable or malformed image identity', () => {
  const { outputDirectory, sbomPath } = fixture();
  assert.throws(
    () =>
      prepareAgentRelease({
        root,
        outputDirectory,
        tag: 'agent-v0.9.0',
        image: 'ghcr.io/example/initpad-agent:latest',
        digest,
        sourceCommit: commit,
        sourceRepository: 'https://github.com/example/initpad',
        sbomPath,
      }),
    /without a tag or digest/,
  );
});
