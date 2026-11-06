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

test('verifies a changed control-plane URL before replacing a saved identity endpoint', () => {
  const source = readFileSync(installer, 'utf8');
  const existingIdentityBranch = source.indexOf(
    "printf 'Keeping the existing Agent identity in %s.\\n'",
  );
  const binding = source.indexOf('verify_identity_binding', existingIdentityBranch);
  const migrate = source.indexOf('migrate_control_plane_url', existingIdentityBranch);

  assert.ok(existingIdentityBranch > 0, 'existing identity branch is missing');
  assert.ok(binding > existingIdentityBranch, 'target binding check is missing');
  assert.ok(migrate > binding, 'URL migration runs before target binding is verified');
  assert.match(source, /migrate-url --url "\$CONTROL_PLANE_URL"/);
  assert.match(source, /existing URL and identity were preserved/);
});

test('uninstalls only what the installer and Agent created for this target', () => {
  const help = execFileSync(installer, ['--help'], { encoding: 'utf8' });
  const source = readFileSync(installer, 'utf8');
  const uninstall = source.slice(
    source.indexOf('# ---- uninstall'),
    source.indexOf('if [ "$UNINSTALL" = true ]; then'),
  );

  assert.match(help, /--uninstall\s+Remove the Agent container/);
  assert.match(help, /--remove-workloads\s+Also remove the containers and networks/);
  // The uninstall branch ends before any install-only step such as the
  // enrollment prompt or an image pull.
  assert.ok(
    source.indexOf('uninstall_agent\n  exit 0') <
      source.indexOf('[ -n "$IMAGE" ] || fail \'--image is required\''),
  );
  // A server enrolled for another target is left untouched.
  assert.match(uninstall, /not '\$EXPECTED_TARGET_ID'; nothing was removed/);
  // Agent containers are recognised by their label, never by name alone.
  assert.match(uninstall, /index \.Config\.Labels "com\.initpad\.agent"/);
  assert.match(uninstall, /used by an unmanaged container; it was not removed/);
  // Workloads and networks are filtered by both the managed and target labels.
  for (const kind of ['docker ps -aq', 'docker network ls -q']) {
    const at = uninstall.indexOf(kind);
    assert.ok(at > 0, `${kind} is missing`);
    const call = uninstall.slice(at, uninstall.indexOf(')', at));
    assert.match(call, /label=com\.initpad\.managed=true/);
    assert.match(call, /label=com\.initpad\.target=\$target_id/);
  }
  // Registry trust is removed only when it is byte-identical to the CA copy
  // Manage Agent installed.
  assert.match(uninstall, /cmp -s "\$file" "\$MANAGED_CA_DIR\/ca\.crt"/);
  // Nothing is removed without an explicit confirmation.
  assert.ok(
    uninstall.indexOf('[ "$answer" = uninstall ]') < uninstall.indexOf('docker rm -f "$name"'),
  );
  assert.match(uninstall, /run in an interactive terminal to confirm, or pass --yes/);
});
