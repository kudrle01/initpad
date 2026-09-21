import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptPath = resolve(root, 'deploy/platform-update-acceptance.sh');
const script = readFileSync(scriptPath, 'utf8');
const runbook = readFileSync(resolve(root, 'deploy/SELF_HOSTED_ACCEPTANCE.md'), 'utf8');

test('rejects malformed or non-increasing versions before inspecting the host', () => {
  for (const versions of [
    ['invalid', '0.2.1'],
    ['0.2.1', '0.2.1'],
    ['0.2.1', '0.2.0'],
  ]) {
    const result = spawnSync(scriptPath, ['prepare', ...versions], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /Docker Engine|requires Linux|deploy\/.env/);
  }
});

test('documents the rollback, interrupted reboot and successful update sequence', () => {
  for (const command of [
    'prepare 0.2.0 0.2.1',
    'fault-rollback',
    'after-rollback',
    'interrupt-reboot',
    'after-reboot',
    'after-success',
  ]) {
    assert.match(runbook, new RegExp(`platform-update-acceptance\\.sh ${command}`));
  }
  assert.match(runbook, /nespouštěj `install\.sh`/);
});

test('fault injection is fixed to the candidate API and always has an unpause fallback', () => {
  assert.match(script, /candidate=\$\(override_image api\)/);
  assert.match(script, /docker pause "\$helper"/);
  assert.match(script, /docker stop -t 0 "\$api_id"/);
  assert.match(script, /trap unpause_on_exit EXIT/);
  assert.match(script, /docker unpause "\$PAUSED_HELPER"/);
  assert.doesNotMatch(script, /\beval\b|docker system prune|docker volume rm/);
});

test('reboot is armed only after sudo validation and a durable cutover checkpoint', () => {
  const sudo = script.indexOf('sudo -v');
  const wait = script.indexOf('operation_id=$(wait_for_candidate_api)', sudo);
  const checkpoint = script.indexOf('mv "$temporary" "$REBOOT_CHECKPOINT"', wait);
  const reboot = script.indexOf('sudo systemctl reboot', checkpoint);
  assert.ok(sudo >= 0 && wait > sudo && checkpoint > wait && reboot > checkpoint);
  assert.match(script, /previous_boot.*!=.*current_boot/);
  assert.match(script, /interrupted\.\*rolled back/);
});

test('final acceptance binds version, durable identities and exact managed workloads', () => {
  assert.match(script, /database_identity/);
  assert.match(script, /managed_workload_snapshot/);
  assert.match(script, /references.*-eq 3/);
  assert.match(script, /status.*succeeded/);
  assert.match(script, /rm -f "\$CHECKPOINT" "\$REBOOT_CHECKPOINT"/);
});

test('reads the root-written runtime override through the Supervisor boundary', () => {
  assert.match(script, /read_runtime_override/);
  assert.match(script, /docker exec initpad-supervisor cat "\$SUPERVISOR_OVERRIDE"/);
  assert.doesNotMatch(script, /sha256sum "\$OVERRIDE"|grep -Ec [^\n]+ "\$OVERRIDE"/);
});

test('refuses fault injection when the running Supervisor helper image is unavailable', () => {
  assert.match(script, /assert_supervisor_helper_image_available/);
  assert.match(script, /docker image inspect "\$image_id"/);
  assert.match(script, /Rebuild the exact installed platform tag/);
  assert.ok(
    script.indexOf(
      'assert_supervisor_helper_image_available',
      script.indexOf('write_checkpoint()'),
    ) <
      script.indexOf('actual=$(state_value currentVersion)', script.indexOf('write_checkpoint()')),
  );
});
