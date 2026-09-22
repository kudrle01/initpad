import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helper = resolve(root, 'deploy/environment-expiry-acceptance.sh');
const source = readFileSync(helper, 'utf8');
const runbook = readFileSync(resolve(root, 'deploy/SELF_HOSTED_ACCEPTANCE.md'), 'utf8');

test('documents explicit TTL arm and verification checkpoints', () => {
  const help = execFileSync(helper, ['--help'], { encoding: 'utf8' });

  assert.match(help, /arm <workspace-slug> <project-name> <dev\|test>/);
  assert.match(help, /verify/);
  assert.match(help, /disposable acceptance installation/i);
});

test('refuses production before contacting Docker or the database', () => {
  const result = spawnSync(helper, ['arm', 'team-alpha', 'sample-project', 'prod'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production can never be used/);
  assert.doesNotMatch(result.stderr, /PostgreSQL|Docker|\.env/);
});

test('requires explicit fault-injection opt-in before inspecting the runtime', () => {
  const result = spawnSync(helper, ['arm', 'team-alpha', 'sample-project', 'dev'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /INITPAD_ACCEPTANCE_ALLOW_EXPIRY=1/);
  assert.doesNotMatch(result.stderr, /PostgreSQL|Docker|\.env/);
});

test('binds verification to an empty environment, audit event and unchanged production', () => {
  assert.match(source, /status.*= 'empty'/);
  assert.match(source, /environment\.expired/);
  assert.match(source, /production_fingerprint/);
  assert.match(source, /The production environment changed/);
  assert.match(source, /rm -f "\$CHECKPOINT"/);
  assert.doesNotMatch(source, /docker system prune|docker volume rm|\beval\b/);
});

test('the self-hosted runbook uses the guarded helper and verifies the result', () => {
  assert.match(runbook, /INITPAD_ACCEPTANCE_ALLOW_EXPIRY=1/);
  assert.match(runbook, /environment-expiry-acceptance\.sh arm/);
  assert.match(runbook, /environment-expiry-acceptance\.sh verify/);
});
