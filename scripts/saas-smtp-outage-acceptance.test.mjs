import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  assertDeliveredAfterRecovery,
  assertQueuedAfterOutage,
  fixtureUsername,
  parseCommand,
} = require(resolve('apps/api/scripts/saas-smtp-outage-probe.js'));
const marker = '123e4567-e89b-42d3-a456-426614174000';

test('rejects malformed input before loading Prisma or opening a database', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('apps/api/scripts/saas-smtp-outage-probe.js'), 'prepare', 'unsafe'],
    {
      encoding: 'utf8',
      env: { INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES: '1' },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /UUID v4/);
  assert.doesNotMatch(result.stderr, /Prisma|database|postgresql:/i);
});

test('accepts only fixed SMTP outage phases and an opaque UUID marker', () => {
  assert.deepEqual(parseCommand(['prepare', marker]), { command: 'prepare', marker });
  assert.deepEqual(parseCommand(['recover', marker]), { command: 'recover', marker });
  assert.deepEqual(parseCommand(['cleanup', marker]), { command: 'cleanup', marker });
  assert.throws(() => parseCommand(['prepare', 'unsafe']), /UUID v4/);
  assert.throws(() => parseCommand(['shell', marker]), /Expected prepare/);
  assert.equal(fixtureUsername(marker), 'smtp-outage-123e4567e89b42d3a456426614174000');
});

test('requires an encrypted retry after outage and erased payload after recovery', () => {
  assert.equal(
    assertQueuedAfterOutage({ status: 'pending', attempts: 1, payloadEncrypted: 'enc:v1:x' }),
    true,
  );
  assert.throws(
    () => assertQueuedAfterOutage({ status: 'sent', attempts: 1, payloadEncrypted: '' }),
    /still reachable/,
  );
  assert.equal(
    assertDeliveredAfterRecovery({
      status: 'sent',
      attempts: 2,
      payloadEncrypted: '',
      lastError: null,
    }),
    true,
  );
  assert.equal(
    assertDeliveredAfterRecovery({
      status: 'pending',
      attempts: 2,
      payloadEncrypted: 'enc:v1:x',
      lastError: 'offline',
    }),
    false,
  );
});
