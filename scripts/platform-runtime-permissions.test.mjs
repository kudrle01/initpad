import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const updater = readFileSync(resolve(root, 'apps/supervisor/src/updater.ts'), 'utf8');
const acceptance = readFileSync(resolve(root, 'deploy/platform-update-acceptance.sh'), 'utf8');
const health = readFileSync(resolve(root, 'deploy/self-hosted-check.sh'), 'utf8');
const backup = readFileSync(resolve(root, 'deploy/backup.sh'), 'utf8');
const restore = readFileSync(resolve(root, 'deploy/restore.sh'), 'utf8');

test('release descriptor remains operator-owned across update, backup and restore', () => {
  assert.match(updater, /atomicWriteHostFile/);
  assert.match(updater, /chown\(temporary, owner\.uid, owner\.gid\)/);
  assert.match(acceptance, /platform release override is not readable by this operator/i);
  assert.match(acceptance, /sha256sum "\$OVERRIDE"/);
  assert.match(health, /\[ -r "\$override" \]/);
  assert.match(backup, /cp \.runtime\/platform-update\/platform-release\.override\.yml/);
  assert.match(
    restore,
    /rm -f "\$RUNTIME_OVERRIDE"[\s\S]+cp "\$src\/platform-release\.override\.yml"/,
  );
});
