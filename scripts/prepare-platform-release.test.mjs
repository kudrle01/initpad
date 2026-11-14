import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  destructiveStatements,
  migrationPolicy,
  preparePlatformRelease,
} from './prepare-platform-release.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const platformVersion = JSON.parse(
  readFileSync(resolve(root, 'deploy/platform-version.json'), 'utf8'),
).version;
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
    tag: `initpad-v${platformVersion}`,
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
  assert.equal(manifest.version, platformVersion);
  assert.equal(
    manifest.images.api.immutableReference,
    `ghcr.io/kudrle01/initpad-api@${digest('a')}`,
  );
  assert.ok(override.includes(`INITPAD_PLATFORM_VERSION: "${platformVersion}"`));
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
  // A contract release is never rolled back to the previous images blindly.
  assert.match(installer, /restore_required=yes/);
  assert.match(installer, /the previous images were not restarted/);
  const checksums = readFileSync(resolve(input.outputDirectory, 'SHA256SUMS'), 'utf8');
  assert.match(checksums, /initpad-platform-release\.json/);
  assert.match(checksums, /initpad-supervisor-sbom\.json/);
});

test('rejects a mismatched tag, mutable image or foreign repository', () => {
  assert.throws(
    () => preparePlatformRelease({ ...options(), tag: 'initpad-v9.9.9' }),
    /release tag must be initpad-v/,
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

function repository(migrations, exceptions) {
  const directory = mkdtempSync(resolve(tmpdir(), 'initpad-migration-policy-'));
  for (const [name, sql] of Object.entries(migrations)) {
    mkdirSync(resolve(directory, 'apps/api/prisma/migrations', name), { recursive: true });
    writeFileSync(resolve(directory, 'apps/api/prisma/migrations', name, 'migration.sql'), sql);
  }
  writeFileSync(
    resolve(directory, 'apps/api/prisma/destructive-migrations.json'),
    JSON.stringify({ migrations: exceptions }),
  );
  return directory;
}

test('the repository migrations satisfy the destructive migration policy', () => {
  const policy = migrationPolicy(root, platformVersion);
  assert.deepEqual(policy.destructiveMigrations, []);
  assert.equal(policy.database.migrationMode, 'expand-contract');
});

test('detects destructive statements but ignores comments and relaxing changes', () => {
  assert.deepEqual(destructiveStatements('ALTER TABLE "A" DROP COLUMN "b";'), ['DROP']);
  assert.deepEqual(destructiveStatements('ALTER TABLE "A" RENAME COLUMN "b" TO "c";'), ['RENAME']);
  assert.deepEqual(destructiveStatements('ALTER TYPE "Role" ADD VALUE \'x\';'), ['ALTER TYPE']);
  assert.deepEqual(destructiveStatements('ALTER TABLE "A" ALTER COLUMN "b" SET DATA TYPE TEXT;'), [
    'ALTER COLUMN TYPE',
  ]);
  assert.deepEqual(destructiveStatements('ALTER TABLE "A" ALTER COLUMN "b" SET NOT NULL;'), [
    'SET NOT NULL',
  ]);
  assert.deepEqual(
    destructiveStatements(
      '-- DROP COLUMN in a comment\nDROP INDEX "x";\nALTER TABLE "A" DROP CONSTRAINT "c";',
    ),
    [],
  );
});

test('refuses a destructive migration without an explicit exception', () => {
  const directory = repository(
    { '20261201000000_drop_legacy': 'ALTER TABLE "User" DROP COLUMN "legacy";' },
    {},
  );
  assert.throws(
    () => migrationPolicy(directory, '0.3.0'),
    /20261201000000_drop_legacy.*without an exception/,
  );
});

test('refuses a new migration disguised as historical', () => {
  const directory = repository(
    { '20261201000000_drop_legacy': 'ALTER TABLE "User" DROP COLUMN "legacy";' },
    { '20261201000000_drop_legacy': { release: 'historical', reason: 'cleanup' } },
  );
  assert.throws(() => migrationPolicy(directory, '0.3.0'), /may be 'historical'/);
});

test('publishes a release with a destructive migration as restore-required', () => {
  const directory = repository(
    { '20261201000000_drop_legacy': 'ALTER TABLE "User" DROP COLUMN "legacy";' },
    {
      '20261201000000_drop_legacy': {
        release: '0.3.0',
        reason: 'legacy column unused since 0.2.30',
      },
    },
  );
  assert.deepEqual(migrationPolicy(directory, '0.3.0'), {
    destructiveMigrations: ['20261201000000_drop_legacy'],
    database: { migrationMode: 'contract', rollback: 'restore-required', backupRequired: true },
  });
  // A later release no longer ships it and is image-compatible again.
  assert.equal(migrationPolicy(directory, '0.3.1').database.rollback, 'image-compatible');
});
