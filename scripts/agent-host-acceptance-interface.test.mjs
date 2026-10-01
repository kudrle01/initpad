import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helper = resolve(root, 'apps/agent/host-acceptance.sh');

test('documents explicit, operator-controlled lifecycle checkpoints', () => {
  const help = execFileSync(helper, ['--help'], { encoding: 'utf8' });

  for (const command of [
    'before-disconnect',
    'disconnected',
    'after-reconnect',
    'before-reboot',
    'after-reboot',
    'before-url-migration',
    'after-url-migration',
    'after-url-rollback',
    'before-update',
    'inject-failure',
    'after-rollback',
    'after-update',
  ]) {
    assert.match(help, new RegExp(command));
  }
  assert.match(help, /credential is never copied/i);
});

test('rejects malformed update versions before requiring root or Docker', () => {
  const result = spawnSync(helper, ['before-update', 'latest'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stable MAJOR\.MINOR\.PATCH/);
});

test('rejects malformed URL migration input before requiring root or Docker', () => {
  const malformedVersion = spawnSync(helper, ['before-url-migration', 'latest'], {
    encoding: 'utf8',
  });
  const relativeUrl = spawnSync(helper, ['after-url-migration', '0.14.3', '/relative'], {
    encoding: 'utf8',
  });
  const emptyAuthority = spawnSync(helper, ['after-url-migration', '0.14.3', 'https://'], {
    encoding: 'utf8',
  });

  assert.notEqual(malformedVersion.status, 0);
  assert.match(malformedVersion.stderr, /stable MAJOR\.MINOR\.PATCH/);
  assert.notEqual(relativeUrl.status, 0);
  assert.match(relativeUrl.stderr, /absolute HTTP\(S\) URL/);
  assert.notEqual(emptyAuthority.status, 0);
  assert.match(emptyAuthority.stderr, /absolute HTTP\(S\) URL/);
});

test('fault injection pauses only while the rollback slot exists and has a fail-safe unpause', () => {
  const source = readFileSync(helper, 'utf8');
  const start = source.indexOf('inject_update_failure()');
  const end = source.indexOf('after_rollback()', start);
  const injection = source.slice(start, end);

  assert.ok(start > 0 && end > start, 'fault-injection function is missing');
  assert.ok(
    injection.indexOf('docker container inspect initpad-agent-previous') <
      injection.indexOf('docker pause "$AGENT_CONTAINER"'),
    'replacement is paused before a rollback slot is verified',
  );
  assert.match(injection, /docker unpause "\$AGENT_CONTAINER"/);
  assert.doesNotMatch(injection, /docker (rm|stop) /);
});

test('exposes an evidence-backed host reboot acceptance flow', () => {
  const help = execFileSync(helper, ['--help'], { encoding: 'utf8' });
  const source = readFileSync(helper, 'utf8');

  assert.match(help, /before-reboot\s+Verify Agent autostart prerequisites/);
  assert.match(help, /after-reboot\s+Prove host reboot restored the same Agent/);
  assert.match(source, /RestartPolicy\.Name/);
  assert.match(source, /systemctl is-enabled --quiet docker\.service/);
  assert.match(source, /kernel\/random\/boot_id/);
  const start = source.indexOf('before_reboot()');
  const end = source.indexOf('check_after_reboot()', start);
  assert.match(source.slice(start, end), /assert_workloads_running "\$ids"/);
  assert.match(source, /Host reboot restored the same Agent identity, container and workloads/);
});

test('proves successful and rejected control-plane URL migration without recording the URL', () => {
  const source = readFileSync(helper, 'utf8');
  const start = source.indexOf('before_url_migration()');
  const end = source.indexOf('before_update()', start);
  const migration = source.slice(start, end);

  assert.ok(start > 0 && end > start, 'URL migration acceptance functions are missing');
  assert.match(migration, /assert_identity_unchanged/);
  assert.match(migration, /Installer did not replace the Agent container/);
  assert.match(migration, /Rejected URL migration replaced the Agent container/);
  assert.match(migration, /assert_workloads_preserved/);
  assert.match(migration, /assert_no_url_migration_residue/);
  assert.match(migration, /url_changed=true/);
  assert.match(migration, /url_preserved=true/);
  assert.doesNotMatch(migration, /record [^\n]*\$expected_url/);
});
