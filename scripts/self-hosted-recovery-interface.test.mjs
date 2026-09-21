import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const acceptance = readFileSync(resolve(root, 'deploy/self-hosted-check.sh'), 'utf8');
const restore = readFileSync(resolve(root, 'deploy/restore.sh'), 'utf8');
const runbook = readFileSync(resolve(root, 'deploy/SELF_HOSTED_ACCEPTANCE.md'), 'utf8');

test('documents an identity-bound destructive restore acceptance sequence', () => {
  const help = execFileSync('bash', ['deploy/self-hosted-check.sh', '--help'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.match(help, /backup <directory>/);
  assert.match(help, /before-restore <directory> <marker-project>/);
  assert.match(help, /after-restore <directory>/);
  assert.match(runbook, /before-restore \.\/backups\/acceptance after-backup/);
  assert.match(runbook, /after-restore \.\/backups\/acceptance/);
});

test('binds restore evidence to the backup manifest, durable identities and marker', () => {
  assert.match(acceptance, /manifest_sha256=/);
  assert.match(acceptance, /identity_fingerprint=/);
  assert.match(acceptance, /save_restore_checkpoint_from_dump/);
  assert.match(acceptance, /temporary backup inspection database/);
  assert.match(acceptance, /Post-backup marker project/);
  assert.match(acceptance, /\.\/recovery-drill\.sh verify-restore/);
  assert.match(acceptance, /rm -f "\$RESTORE_CHECKPOINT"/);
});

test('removes stale managed workloads before declaring restore complete', () => {
  const removeIndex = restore.indexOf('docker rm -f "${managed_containers[@]}"');
  const completeIndex = restore.indexOf('Restore complete.');

  assert.notEqual(removeIndex, -1);
  assert.notEqual(completeIndex, -1);
  assert.ok(removeIndex < completeIndex);
});
