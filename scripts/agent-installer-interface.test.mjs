import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// Runs only the capacity function of the installer against a stub Docker
// daemon and `df`, so the thresholds are tested without a real host.
function runCapacity({ memMiB, cpus, freeGiB, skip = false }) {
  const source = readFileSync(installer, 'utf8');
  const block = source.slice(
    source.indexOf('# ---- capacity'),
    source.indexOf('# ---- end capacity'),
  );
  const dir = mkdtempSync(resolve(tmpdir(), 'agent-capacity-'));
  try {
    writeFileSync(
      resolve(dir, 'docker'),
      `#!/bin/sh
case "$*" in
  *MemTotal*) echo ${memMiB * 1048576} ;;
  *NCPU*) echo ${cpus} ;;
  *DockerRootDir*) echo ${dir} ;;
esac
`,
    );
    writeFileSync(
      resolve(dir, 'df'),
      `#!/bin/sh\necho Filesystem\necho x 1 1 ${freeGiB * 1048576} 1% /\n`,
    );
    chmodSync(resolve(dir, 'docker'), 0o755);
    chmodSync(resolve(dir, 'df'), 0o755);
    const script = `PROGRAM=t
PUBLISHED_HOST=
SKIP_CAPACITY_CHECK=${skip}
fail() { printf '%s\\n' "$1" >&2; exit 1; }
warn() { printf 'warning: %s\\n' "$1" >&2; }
${block}
check_capacity
echo done`;
    const result = spawnSync('sh', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    return { status: result.status, out: result.stdout, err: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('stops an Agent install on a server below the minimum size', () => {
  const small = runCapacity({ memMiB: 900, cpus: 1, freeGiB: 30 });
  assert.equal(small.status, 1);
  assert.match(small.err, /below the minimum size/);
  assert.match(small.err, /RAM: 900 MiB/);
  assert.match(small.err, /--skip-capacity-check/);

  const tinyDisk = runCapacity({ memMiB: 4000, cpus: 2, freeGiB: 5 });
  assert.equal(tinyDisk.status, 1);
  assert.match(tinyDisk.err, /Disk: 5 GiB free/);
});

test('warns, but continues, between the minimum and recommended size', () => {
  const ok = runCapacity({ memMiB: 2000, cpus: 1, freeGiB: 15 });
  assert.equal(ok.status, 0);
  assert.match(ok.out, /done/);
  assert.match(ok.err, /below the recommended size/);
  assert.match(ok.err, /RAM: 2000 MiB/);
  assert.match(ok.err, /CPU: 1 available/);
  assert.match(ok.err, /Disk: 15 GiB free/);
});

test('accepts a recommended-size server silently and lets the operator override', () => {
  const big = runCapacity({ memMiB: 3900, cpus: 2, freeGiB: 40 });
  assert.equal(big.status, 0);
  assert.equal(big.err, '');

  const forced = runCapacity({ memMiB: 900, cpus: 1, freeGiB: 30, skip: true });
  assert.equal(forced.status, 0);
  assert.match(forced.err, /continuing because of --skip-capacity-check/);
});

test('checks capacity after validation and never on uninstall', () => {
  const source = readFileSync(installer, 'utf8');
  const call = source.indexOf('\ncheck_capacity\n');
  assert.ok(
    call > source.indexOf("docker info >/dev/null 2>&1 || fail 'Docker Engine is not reachable'"),
  );
  assert.ok(call > source.indexOf('uninstall_agent\n  exit 0'));
  assert.ok(call < source.indexOf('run the installer in an interactive terminal'));
});

// Runs only the gateway validation of the installer; it fails before any
// Docker call, so no daemon is needed.
function runGatewayValidation(variables) {
  const source = readFileSync(installer, 'utf8');
  const block = source.slice(
    source.indexOf('# ---- gateway'),
    source.indexOf('# ---- end gateway'),
  );
  const script = `PROGRAM=t
fail() { printf '%s\\\\n' "$1" >&2; exit 1; }
warn() { printf 'warning: %s\\\\n' "$1" >&2; }
GATEWAY_ADMIN_SOCKET=
GATEWAY_CONTAINER=
PUBLISHED_HOST=
${variables}
${block}
docker() { echo "docker must not be called" >&2; exit 99; }
getent() { return 0; }
mkdir() { echo "reached filesystem setup" >&2; exit 0; }
setup_gateway`;
  const result = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  return { status: result.status, err: result.stderr };
}

test('documents the one-command gateway and its removal', () => {
  const help = execFileSync(installer, ['--help'], { encoding: 'utf8' });
  assert.match(help, /--gateway-domain DOMAIN\s+Set up the managed gateway on this server/);
  assert.match(help, /--remove-gateway\s+Also remove the gateway this installer set up/);
});

test('rejects a gateway domain that is not a plain DNS name', () => {
  for (const domain of [
    '10.0.0.5',
    'Apps.Example.lan',
    'nodots',
    'a b.example.lan',
    '-x.example.lan',
  ]) {
    const result = runGatewayValidation(`GATEWAY_DOMAIN='${domain}'`);
    assert.equal(result.status, 1, `${domain} was accepted`);
    assert.match(result.err, /--gateway-domain must be/);
  }
});

test('warns about .local and refuses to mix --gateway-domain with a hand-made gateway', () => {
  const local = runGatewayValidation(`GATEWAY_DOMAIN=apps.lab.local`);
  assert.match(local.err, /ends in \.local, which is reserved for mDNS/);
  assert.match(local.err, /reached filesystem setup/);

  const mixed = runGatewayValidation(
    `GATEWAY_DOMAIN=apps.lab.lan\nGATEWAY_ADMIN_SOCKET=/run/x/admin.sock`,
  );
  assert.equal(mixed.status, 1);
  assert.match(mixed.err, /do not combine it with --gateway-admin-socket/);

  const remote = runGatewayValidation(`GATEWAY_DOMAIN=apps.lab.lan\nPUBLISHED_HOST=docker.lab`);
  assert.equal(remote.status, 1);
  assert.match(remote.err, /needs a local Docker daemon/);
});

test('starts every gateway container hardened, pinned and owned by the installer', () => {
  const source = readFileSync(installer, 'utf8');
  const block = source.slice(
    source.indexOf('# ---- gateway'),
    source.indexOf('# ---- end gateway'),
  );

  assert.match(block, /^CADDY_IMAGE='[^']+@sha256:[a-f0-9]{64}'$/m);
  assert.match(block, /^STEP_CA_IMAGE='[^']+@sha256:[a-f0-9]{64}'$/m);
  const runs = block.split('docker run -d --name ').slice(1);
  assert.equal(runs.length, 3);
  for (const run of runs) {
    const command = run.slice(0, run.indexOf('>/dev/null'));
    assert.match(command, /--read-only/);
    assert.match(command, /--cap-drop ALL --cap-add NET_BIND_SERVICE/);
    assert.match(command, /--security-opt no-new-privileges/);
    assert.match(command, /--memory \d+m/);
    assert.match(command, /--label "\$GATEWAY_LABEL"/);
  }
  assert.doesNotMatch(block, /docker\.sock/);
  // Only the edge publishes ports (HTTP and HTTPS).
  const edgeRun = runs.find((run) => run.startsWith('"$GATEWAY_EDGE"'));
  assert.equal([...block.matchAll(/--publish /g)].length, 2);
  assert.equal([...edgeRun.matchAll(/--publish /g)].length, 2);
  // A foreign container with the same name is never replaced.
  assert.match(block, /was not created by this installer/);
});

test('sets up the gateway after the capacity check and removes it only on request', () => {
  const source = readFileSync(installer, 'utf8');
  const setup = source.indexOf('\nif [ -n "$GATEWAY_DOMAIN" ]; then\n  setup_gateway');
  assert.ok(setup > source.indexOf('\ncheck_capacity\n'));
  assert.ok(setup < source.indexOf('--published-host contains unsupported characters'));
  assert.ok(setup > source.indexOf('uninstall_agent\n  exit 0'));

  const removal = source.indexOf('remove_gateway\n  fi');
  assert.ok(removal > source.indexOf("Type 'uninstall' to continue"));
  assert.match(
    source,
    /\[ "\$REMOVE_GATEWAY" = false \] \|\| fail '--remove-gateway is only valid with --uninstall'/,
  );
});

test('gateway edge sets an explicit ACME issuer so .local names do not use the internal CA', () => {
  const script = readFileSync(installer, 'utf8');
  const edge = script.slice(script.indexOf("<<'EDGE'"), script.indexOf('\nEDGE\n'));
  assert.match(
    edge,
    /cert_issuer acme\s*\{[\s\S]*?dir https:\/\/ca:9000\/acme\/acme\/directory[\s\S]*?trusted_roots \/etc\/caddy\/ca-root\.crt/,
  );
  assert.doesNotMatch(edge, /acme_ca\b/);
});
