import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const probePath = resolve('apps/api/scripts/saas-dependency-probe.js');
const loadProbePath = resolve('apps/api/scripts/saas-load-probe.js');
const smtpOutageProbePath = resolve('apps/api/scripts/saas-smtp-outage-probe.js');
const acceptance = readFileSync('deploy/saas-acceptance.sh', 'utf8');
const probeSource = readFileSync(probePath, 'utf8');
const loadProbeSource = readFileSync(loadProbePath, 'utf8');
const smtpOutageProbeSource = readFileSync(smtpOutageProbePath, 'utf8');
const {
  artifactRoundTrip,
  createRecoveryMarker,
  evaluateRecoveryState,
  isNotFound,
  markerKey,
  parseCommand,
  verifyRecovery,
} = require(probePath);
const baseline = '123e4567-e89b-42d3-a456-426614174000';
const postBackup = '223e4567-e89b-42d3-a456-426614174000';

test('accepts only fixed recovery commands and bounded UUID markers', () => {
  assert.deepEqual(parseCommand(['probe']), { command: 'probe', values: [] });
  assert.deepEqual(parseCommand(['baseline', baseline]), {
    command: 'baseline',
    values: [baseline],
  });
  assert.deepEqual(parseCommand(['verify-restore', baseline, postBackup]), {
    command: 'verify-restore',
    values: [baseline, postBackup],
  });
  assert.throws(() => parseCommand(['verify-restore', baseline, baseline]), /must differ/);
  assert.throws(() => parseCommand(['baseline', 'not-a-marker']), /UUID v4/);
  assert.throws(() => parseCommand(['shell', 'echo unsafe']), /expected probe/);
  assert.equal(markerKey(baseline), `acceptance/recovery/${baseline}.json`);
});

test('requires one consistent baseline across database and object storage', () => {
  assert.equal(
    evaluateRecoveryState({
      baselineDatabase: true,
      baselineObject: true,
      postBackupDatabase: false,
      postBackupObject: false,
    }),
    true,
  );
  for (const key of [
    'baselineDatabase',
    'baselineObject',
    'postBackupDatabase',
    'postBackupObject',
  ]) {
    const state = {
      baselineDatabase: true,
      baselineObject: true,
      postBackupDatabase: false,
      postBackupObject: false,
    };
    state[key] = !state[key];
    assert.equal(evaluateRecoveryState(state), false);
  }
  assert.equal(isNotFound({ name: 'NoSuchKey' }), true);
  assert.equal(isNotFound({ $metadata: { httpStatusCode: 404 } }), true);
  assert.equal(isNotFound({ $metadata: { httpStatusCode: 403 } }), false);
});

test('rejects malformed input before opening external dependencies', () => {
  const result = spawnSync(process.execPath, [probePath, 'baseline', 'invalid'], {
    encoding: 'utf8',
    env: {},
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /marker must be a UUID v4/);
  assert.doesNotMatch(result.stderr, /Prisma|S3|credential|postgresql:/i);
});

test('round-trips and removes the exact private object', async () => {
  const objects = new Map();
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.constructor.name);
      const { Key } = command.input;
      if (command.constructor.name === 'HeadBucketCommand') return {};
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(Key, Buffer.from(command.input.Body));
        return {};
      }
      if (command.constructor.name === 'GetObjectCommand') {
        return {
          Body: {
            transformToByteArray: async () => objects.get(Key),
          },
        };
      }
      if (command.constructor.name === 'DeleteObjectCommand') {
        objects.delete(Key);
        return {};
      }
      throw new Error('unexpected test command');
    },
  };

  await artifactRoundTrip(client, 'private-bucket');

  assert.deepEqual(commands, [
    'HeadBucketCommand',
    'PutObjectCommand',
    'GetObjectCommand',
    'DeleteObjectCommand',
  ]);
  assert.equal(objects.size, 0);
});

test('proves and cleans one consistent database and object-store checkpoint', async () => {
  const rows = new Map();
  const objects = new Map();
  let schemaDropped = false;
  const prisma = {
    async $executeRawUnsafe(sql, ...values) {
      if (sql.includes('INSERT INTO')) rows.set(values[0], values[1]);
      if (sql.includes('DELETE FROM') && sql.includes('marker =')) rows.delete(values[0]);
      if (sql.includes('DELETE FROM') && sql.includes('marker IN')) {
        rows.delete(values[0]);
        rows.delete(values[1]);
      }
      if (sql.includes('DROP SCHEMA')) schemaDropped = true;
      return 1;
    },
    async $queryRawUnsafe(sql, ...values) {
      if (sql.includes('SELECT EXISTS')) return [{ exists: rows.has(values[0]) }];
      if (sql.includes('count(*)')) return [{ count: rows.size }];
      throw new Error('unexpected test query');
    },
  };
  const client = {
    async send(command) {
      const { Key } = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(Key, Buffer.from(command.input.Body));
        return {};
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        if (objects.has(Key)) return {};
        const error = new Error('missing');
        error.name = 'NoSuchKey';
        throw error;
      }
      if (command.constructor.name === 'DeleteObjectCommand') {
        objects.delete(Key);
        return {};
      }
      throw new Error('unexpected test command');
    },
  };

  await createRecoveryMarker(prisma, client, 'private-bucket', baseline, 'baseline');
  await createRecoveryMarker(prisma, client, 'private-bucket', postBackup, 'post-backup');
  rows.delete(postBackup);
  objects.delete(markerKey(postBackup));

  await verifyRecovery(prisma, client, 'private-bucket', baseline, postBackup);

  assert.equal(rows.size, 0);
  assert.equal(objects.size, 0);
  assert.equal(schemaDropped, true);
});

test('keeps live acceptance explicit, provider-neutral and secret-file based', () => {
  assert.match(acceptance, /dependencies\) check_dependencies/);
  assert.match(acceptance, /email\) check_email/);
  assert.match(acceptance, /INITPAD_SMTP_ACCEPTANCE_RECIPIENT/);
  assert.match(acceptance, /scripts\/saas-email-probe\.js/);
  assert.match(acceptance, /before-backup\) before_backup/);
  assert.match(acceptance, /after-backup\) after_backup/);
  assert.match(acceptance, /after-restore\) after_restore/);
  assert.match(acceptance, /load\) check_load/);
  assert.match(acceptance, /smtp-outage-before\) smtp_outage_before/);
  assert.match(acceptance, /smtp-outage-after\) smtp_outage_after/);
  assert.match(acceptance, /smtp-outage-cleanup\) smtp_outage_cleanup/);
  assert.match(acceptance, /scripts\/saas-load-probe\.js/);
  assert.match(acceptance, /scripts\/saas-smtp-outage-probe\.js/);
  assert.match(acceptance, /INITPAD_SAAS_ACCEPTANCE:-0/);
  assert.match(acceptance, /scripts\/run-with-secrets\.js/);
  assert.match(acceptance, /--proto '=https'/);
  assert.match(acceptance, /\/proc\/sys\/kernel\/random\/uuid/);
  assert.doesNotMatch(acceptance, /require_command "node"/);
  assert.match(acceptance, /chmod 600/);
  assert.doesNotMatch(acceptance, /source "?\$ENV_FILE|\. "?\$ENV_FILE/);
  assert.doesNotMatch(acceptance, /set -x|docker\.sock/);

  assert.match(probeSource, /HeadBucketCommand/);
  assert.match(probeSource, /PutObjectCommand/);
  assert.match(probeSource, /GetObjectCommand/);
  assert.match(probeSource, /DeleteObjectCommand/);
  assert.match(probeSource, /_prisma_migrations/);
  assert.match(loadProbeSource, /Load acceptance requires a quiescent staging control plane/);
  assert.match(loadProbeSource, /INITPAD_LOAD_ACCEPTANCE_MIN_INSTANCES/);
  assert.match(smtpOutageProbeSource, /SMTP_OUTAGE_PREPARED/);
  assert.match(smtpOutageProbeSource, /payload_erased=true/);
});
