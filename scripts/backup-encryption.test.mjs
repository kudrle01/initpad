import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const crypt = resolve(root, 'deploy/backup-crypt.sh');
const backup = readFileSync(resolve(root, 'deploy/backup.sh'), 'utf8');
const restore = readFileSync(resolve(root, 'deploy/restore.sh'), 'utf8');
const haveAge = spawnSync('age-keygen', ['--version']).status === 0;

const run = (args) => spawnSync('bash', [crypt, ...args], { encoding: 'utf8' });

function keyPair(directory, name) {
  const identity = join(directory, `${name}.key`);
  assert.equal(spawnSync('age-keygen', ['-o', identity]).status, 0);
  const recipient = spawnSync('age-keygen', ['-y', identity], { encoding: 'utf8' }).stdout;
  const recipients = join(directory, `${name}.pub`);
  writeFileSync(recipients, recipient);
  return { identity, recipients };
}

test(
  'encrypts a checkpoint for public recipients and restores it byte for byte (ADR-151)',
  { skip: !haveAge && 'age is not installed' },
  () => {
    const work = mkdtempSync(join(tmpdir(), 'initpad-backup-'));
    const checkpoint = join(work, '20261009T020000Z');
    mkdirSync(checkpoint);
    writeFileSync(join(checkpoint, 'initpad.env'), 'INITPAD_JWT_SECRET=very-secret-value\n');
    writeFileSync(join(checkpoint, 'postgres.dump'), Buffer.from([0, 1, 2, 3, 255]));
    const owner = keyPair(work, 'owner');
    const stranger = keyPair(work, 'stranger');
    const encrypted = `${checkpoint}.tar.age`;

    assert.equal(run(['encrypt', checkpoint, encrypted, owner.recipients]).status, 0);
    assert.equal(statSync(encrypted).mode & 0o777, 0o600);
    assert.ok(!readFileSync(encrypted).includes('very-secret-value'));
    assert.notEqual(run(['encrypt', checkpoint, encrypted, owner.recipients]).status, 0);

    const wrong = join(work, 'wrong');
    mkdirSync(wrong);
    assert.notEqual(run(['decrypt', encrypted, wrong, stranger.identity]).status, 0);

    const restored = join(work, 'restored');
    mkdirSync(restored);
    assert.equal(run(['decrypt', encrypted, restored, owner.identity]).status, 0);
    for (const file of ['initpad.env', 'postgres.dump']) {
      assert.deepEqual(readFileSync(join(restored, file)), readFileSync(join(checkpoint, file)));
    }
  },
);

test('backup checks encryption before the maintenance window and rotates encrypted files', () => {
  const check = backup.indexOf('INITPAD_BACKUP_AGE_RECIPIENTS_FILE:-');
  assert.ok(check > 0 && check < backup.indexOf('Quiescing platform writers'));
  const encrypt = backup.indexOf('./backup-crypt.sh encrypt');
  assert.ok(encrypt > backup.lastIndexOf('restart_previous_services'));
  assert.match(backup, /existing_backups=\(\.\/backups\/\*\/ \.\/backups\/\*\.tar\.age\)/);
  assert.match(backup, /shopt -s nullglob/);
});

test('restore decrypts into a private directory and removes it on every exit', () => {
  assert.match(restore, /\.\/backup-crypt\.sh decrypt "\$src" "\$decrypted_backup" "\$identity"/);
  assert.match(restore, /chmod 700 "\$decrypted_backup"/);
  const cleanups = restore.match(/rm -rf -- "\$decrypted_backup"/g) ?? [];
  assert.equal(cleanups.length, 2, 'failure trap and success path');
});
