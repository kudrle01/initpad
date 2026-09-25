import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = resolve(root, 'apps/agent/install.sh');

test('documents explicit re-enrollment without making it the default', () => {
  const help = execFileSync(installer, ['--help'], { encoding: 'utf8' });

  assert.match(help, /--re-enroll\s+Replace a stale\/revoked identity using a new token/);
  assert.match(help, /--expected-target-id ID\s+Refuse an identity belonging to another target/);
  assert.doesNotMatch(help, /automatically re-enroll/i);
});

test('verifies a saved identity before parking the running Agent', () => {
  const source = readFileSync(installer, 'utf8');
  const preflight = source.indexOf('Existing Agent identity verified.');
  const park = source.indexOf('docker stop "$CONTAINER_NAME"');

  assert.ok(preflight > 0, 'identity preflight is missing');
  assert.ok(park > preflight, 'the old Agent is stopped before identity verification');
  assert.ok(
    source.indexOf('verify_identity_binding') < preflight,
    'target binding is not verified before the running Agent is parked',
  );
  assert.match(source, /not intended target/);
  assert.match(source, /rerun this command with --re-enroll/);
});

test('keeps explicit Agent restart semantics and warns about disabled Docker autostart', () => {
  const source = readFileSync(installer, 'utf8');

  assert.match(source, /--restart unless-stopped/);
  assert.match(source, /systemctl is-enabled --quiet docker\.service/);
  assert.match(source, /Docker is running but docker\.service is not enabled for host boot/);
  assert.doesNotMatch(source, /systemctl enable --now/);
});
