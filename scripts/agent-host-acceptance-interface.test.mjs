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
