import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const installer = readFileSync(resolve(root, 'deploy/install.sh'), 'utf8');

test('reconciles newly required generated secrets into legacy environments', () => {
  const secrets = installer.slice(
    installer.indexOf('# ---- 1. configuration + secrets'),
    installer.indexOf('# The Supervisor mounts this checkout'),
  );

  assert.match(secrets, /awk -F= '\$2=="__GENERATE__" \{print \$1\}' \.env\.example/);
  assert.match(secrets, /value=\$\(get_env "\$key"\)/);
  assert.match(secrets, /\[ -z "\$value" \] \|\| \[ "\$value" = __GENERATE__ \]/);
  assert.match(secrets, /set_env "\$key" "\$\(random_secret\)"/);
});

test('reconciles the persisted Gitea OIDC source after a public URL change', () => {
  const sso = installer.slice(
    installer.indexOf('# ---- 5. SSO'),
    installer.indexOf('# ---- 6. HTTPS proxy'),
  );

  assert.match(sso, /admin auth list/);
  assert.match(sso, /admin auth update-oauth --id "\$sso_source_id"/);
  assert.match(sso, /admin auth add-oauth --name initpad-sso/);
  assert.match(sso, /--auto-discover-url "\$sso_discovery_url"/);
  assert.match(sso, /\$COMPOSE restart gitea/);
  assert.match(sso, /wait_healthy gitea 60/);
  assert.ok(
    sso.indexOf('update-oauth') < sso.indexOf('$COMPOSE restart gitea'),
    'Gitea must reload only after the persisted OIDC source is updated',
  );
});

test('routes the server profile API through exactly one trusted proxy hop', () => {
  const caddyfile = readFileSync(resolve(root, 'deploy/Caddyfile'), 'utf8');
  const compose = readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8');
  const platform = caddyfile.slice(
    caddyfile.indexOf('\n{$INITPAD_DOMAIN} {'),
    caddyfile.indexOf('\n{$INITPAD_GIT_DOMAIN} {'),
  );
  assert.ok(platform.length > 0, 'the HTTPS platform site must exist');

  // Caddy -> web proxy -> API would be two hops while direct and CI traffic
  // reach the API through the web proxy alone. Sending the API straight from
  // Caddy keeps one hop on every path, matching the default below.
  assert.match(platform, /handle \/api\/\* \{\s*reverse_proxy api:3000\s*\}/);
  assert.ok(
    platform.indexOf('handle /api/*') < platform.indexOf('reverse_proxy web:80'),
    'API requests must be matched before the web fallback',
  );
  assert.match(compose, /INITPAD_TRUST_PROXY_HOPS: \$\{INITPAD_TRUST_PROXY_HOPS:-1\}/);
  assert.doesNotMatch(caddyfile, /trusted_proxies/);
  for (const site of ['\n{$INITPAD_DOMAIN} {', '\n{$INITPAD_GIT_DOMAIN} {']) {
    const block = caddyfile.slice(caddyfile.indexOf(site));
    assert.match(block, /header Strict-Transport-Security "max-age=31536000"/);
  }
});

test('serves only the public root certificate of the internal CA (ADR-161)', () => {
  const caddyfile = readFileSync(resolve(root, 'deploy/Caddyfile'), 'utf8');
  const snippet = caddyfile.slice(
    caddyfile.indexOf('(initpad_ca) {'),
    caddyfile.indexOf('http://{$INITPAD_DOMAIN} {'),
  );
  const plainHttp = caddyfile.slice(
    caddyfile.indexOf('http://{$INITPAD_DOMAIN} {'),
    caddyfile.indexOf('\n{$INITPAD_DOMAIN} {'),
  );

  // The rewrite pins every request of the handler to the public root, so the
  // CA private key stored next to it can never be requested.
  assert.match(snippet, /handle \/initpad-ca\.crt \{/);
  assert.match(snippet, /root \* \/data\/caddy\/pki\/authorities\/local\n/);
  assert.match(snippet, /rewrite \* \/root\.crt\n/);
  assert.doesNotMatch(caddyfile, /root\.key|file_server browse/);
  // Plain HTTP exposes nothing but the CA download and the HTTPS redirect.
  assert.match(plainHttp, /import initpad_ca/);
  assert.match(plainHttp, /handle \{\s*redir https:\/\/\{host\}\{uri\} 308\s*\}/);
  assert.doesNotMatch(plainHttp, /reverse_proxy/);
});

test('trusts the internal CA only for the registry hostname (ADR-161)', () => {
  const daemon = readFileSync(resolve(root, 'deploy/runner/ci-daemon.sh'), 'utf8');
  const compose = readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8');
  const proxy = installer.slice(
    installer.indexOf('# ---- 6. HTTPS proxy'),
    installer.indexOf('# ---- 7. summary'),
  );

  // Only the exported public root is shared, read-only, with the CI daemon.
  assert.match(compose, /- \.\/\.runtime\/tls:\/opt\/initpad-tls:ro/);
  assert.doesNotMatch(compose, /caddy-data:\/[^\n]*\n[^\n]*runner/);
  assert.match(proxy, /cat \/data\/caddy\/pki\/authorities\/local\/root\.crt/);
  assert.doesNotMatch(proxy, /root\.key/);
  // Per-registry Docker trust; the system-wide trust store stays unchanged.
  assert.match(proxy, /dir=\/etc\/docker\/certs\.d\/\$registry/);
  assert.doesNotMatch(installer, /update-ca-certificates|\/usr\/local\/share\/ca-certificates/);
  assert.doesNotMatch(compose, /--insecure-registry=\$\{INITPAD_(CI_)?REGISTRY_HOST/);
  assert.match(daemon, /certs\.d\/\$INITPAD_CI_REGISTRY_HOST/);
  // The containerd image store fetches tokens with the system roots, so the
  // daemon's own bundle must carry the CA before it starts (push, not pull).
  assert.match(daemon, /SSL_CERT_FILE=\/tmp\/initpad-ca-bundle\.crt/);
  assert.ok(
    daemon.indexOf('SSL_CERT_FILE') < daemon.indexOf('dockerd-entrypoint.sh'),
    'the bundle must be exported before the daemon starts',
  );
  // Name resolution is checked before anything starts and again from inside Docker.
  assert.ok(
    installer.indexOf('report_dns "$DOMAIN"') < installer.indexOf('# ---- 2. core services'),
    'DNS is reported before the services start',
  );
  assert.match(installer, /exec -T runner-docker nslookup "\$ci_git"/);
  assert.match(installer, /Domains=~\$\{name#\*\.\}/);
  // An active ufw would drop CI traffic to the server's own address.
  assert.match(installer, /ufw allow in on "\$runner_bridge" to any port 80,443/);
  assert.ok(
    daemon.indexOf('certs.d') < daemon.indexOf('dockerd-entrypoint.sh'),
    'the CA must be in place before the daemon starts',
  );
  // The daemon reads the CA only when it starts, so the proxy and the CA
  // export run before the CI daemon is started or recreated.
  assert.ok(proxy.indexOf('export_internal_ca\n') < proxy.indexOf('up -d runner-docker'));
  assert.match(proxy, /up -d --force-recreate runner-docker/);
});

test('fills every address from one network answer (ADR-161)', () => {
  const network = installer.slice(
    installer.indexOf('# ---- network'),
    installer.indexOf('# Reconcile generated secrets'),
  );
  const internal = network.slice(
    network.indexOf('apply_domain_network()'),
    network.indexOf('check_domain_pair()'),
  );

  for (const key of [
    'INITPAD_DOMAIN',
    'INITPAD_GIT_DOMAIN',
    'INITPAD_PUBLIC_URL',
    'INITPAD_GITEA_PUBLIC_URL',
    'INITPAD_REGISTRY_HOST',
    'INITPAD_CI_REGISTRY_HOST',
    'INITPAD_GITEA_RUNNER_URL',
    'INITPAD_TLS_DIRECTIVE',
  ]) {
    assert.match(internal, new RegExp(`set_env ${key} `), `${key} must be written`);
  }
  // Throwaway CI job images never receive the CA, so their checkout must use
  // the private same-host port in the internal-CA mode.
  assert.match(
    internal,
    /set_env INITPAD_TLS_DIRECTIVE "tls internal"\n[\s\S]*?set_env INITPAD_GITEA_RUNNER_URL "http:\/\/host\.docker\.internal:\$gitea_port"/,
  );
  // Re-runs keep the configuration; only a fresh .env or --reconfigure asks.
  assert.match(network, /elif \[ "\$FRESH_ENV" = yes \] \|\| \[ "\$RECONFIGURE" = yes \]; then/);
  assert.match(network, /if \[ -t 0 \] && \[ -t 2 \]; then\n\s*network_wizard/);
});

test('verifies the database password over the network, not trusted loopback', () => {
  const check = installer.slice(
    installer.indexOf('say "Waiting for PostgreSQL"'),
    installer.indexOf('say "Waiting for Gitea"'),
  );

  assert.match(check, /psql -h postgres -U initpad/);
  assert.doesNotMatch(check, /-h 127\.0\.0\.1/);
});

const releaseCheck = installer.slice(
  installer.indexOf('# A signed release installed by the Supervisor pins'),
  installer.indexOf('# A normal self-hosted installation'),
);

function runReleaseCheck(override, platformVersion) {
  const work = mkdtempSync(join(tmpdir(), 'initpad-release-check-'));
  const runtimeOverride = join(work, 'platform-release.override.yml');
  writeFileSync(runtimeOverride, override);
  const script = [
    'set -euo pipefail',
    'warn() { printf "%s\\n" "$*" >&2; }',
    'fail() { printf "%s\\n" "$*" >&2; exit 1; }',
    `runtime_override=${JSON.stringify(runtimeOverride)}`,
    `platform_version=${platformVersion}`,
    releaseCheck,
  ].join('\n');
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { ...result, work, override: readFileSync(runtimeOverride, 'utf8') };
}

const pinnedRelease = (version) =>
  `services:\n  api:\n    image: "ghcr.io/x/api@sha256:${'a'.repeat(64)}"\n` +
  `    environment:\n      INITPAD_PLATFORM_VERSION: "${version}"\n`;

test('sets aside a signed release older than the checkout', () => {
  const result = runReleaseCheck(pinnedRelease('0.2.14'), '0.2.33');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.override, 'services: {}\n');
  assert.match(result.stderr, /0\.2\.14 is older than this checkout \(0\.2\.33\)/);
  assert.ok(readdirSync(result.work).includes('platform-release.override.yml.superseded-0.2.14'));
});

test('refuses a checkout older than the installed signed release', () => {
  const result = runReleaseCheck(pinnedRelease('0.10.0'), '0.9.40');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git switch --detach initpad-v0\.10\.0/);
  assert.equal(result.override, pinnedRelease('0.10.0'));
});

test('keeps a signed release of the checkout version and a source install', () => {
  for (const override of [pinnedRelease('0.2.33'), 'services: {}\n']) {
    const result = runReleaseCheck(override, '0.2.33');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.override, override);
  }
});

test('discards a CI runner registration unknown to a recreated Gitea', () => {
  const rotation = installer.slice(
    installer.indexOf('rotate_runner_if_address_changed() {'),
    installer.indexOf('runner_id=$(printf'),
  );

  // A recreated Gitea reuses id 1 and the runner name; only the uuid differs.
  assert.match(rotation, /s\/\.\*\\"uuid\\"/);
  assert.match(rotation, /WHERE uuid='\$runner_uuid'/);
  assert.match(rotation, /\*\[!0-9a-f-\]\*\) fail/);
  assert.ok(
    rotation.indexOf('stop act_runner') < rotation.indexOf('rm -f /data/.runner'),
    'the runner must stop before its registration is removed',
  );
});

test('enables the CI action mirror only after verifying it (ADR-171)', () => {
  const mirror = installer.slice(
    installer.indexOf('mirror_ci_actions() {'),
    installer.indexOf('say "Preparing CI action mirrors"'),
  );

  assert.match(mirror, /set_env INITPAD_CI_ACTIONS_MIRROR "\$runner_url"/);
  assert.match(mirror, /set_env INITPAD_CI_ACTIONS_MIRROR ""/);
  assert.ok(
    mirror.indexOf('action_commit_mirrored') < mirror.indexOf('set_env INITPAD_CI_ACTIONS_MIRROR'),
  );
  assert.match(
    installer,
    /^mirror_ci_actions\n(#[^\n]*\n)*\.\/render-runner-config\.sh$/m,
    'the runner configuration must be rendered again after the mirror check',
  );
  assert.ok(
    installer.indexOf('say "Preparing CI action mirrors"') <
      installer.indexOf('say "Starting the CI runner"'),
  );
});

test('keeps API deployment working files on disk, not in tmpfs (ADR-172)', () => {
  const compose = readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8');
  const api = compose.slice(compose.indexOf('\n  api:\n'), compose.indexOf('\n  web:\n'));
  const backup = readFileSync(resolve(root, 'deploy/backup.sh'), 'utf8');

  assert.match(api, /^ {6}TMPDIR: \/var\/lib\/initpad-work$/m);
  assert.match(api, /^ {6}- api-work:\/var\/lib\/initpad-work$/m);
  assert.match(compose, /^ {2}api-work: \{\}$/m);
  // Exported image archives are disposable and may be large.
  assert.doesNotMatch(backup, /api-work/);
});

function runNetworkFunctions(envText, script) {
  const dir = mkdtempSync(join(tmpdir(), 'initpad-network-'));
  writeFileSync(join(dir, '.env'), envText);
  const helpers = installer.slice(
    installer.indexOf('get_env() {'),
    installer.indexOf('# This stack bundles Gitea'),
  );
  const network = installer.slice(
    installer.indexOf('valid_ipv4() {'),
    installer.indexOf('check_domain_pair() {'),
  );
  const result = spawnSync(
    'bash',
    ['-c', `say() { :; }; warn() { :; }; ${helpers}\n${network}\n${script}`],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return { env: readFileSync(join(dir, '.env'), 'utf8'), stdout: result.stdout };
}

test('--ip fills every address consistently and opens app ports to the LAN (ADR-175)', () => {
  const { env } = runNetworkFunctions(
    'INITPAD_WEB_PORT=8090\nINITPAD_GITEA_HTTP_PORT=3005\nINITPAD_DOMAIN=old.example\n',
    'apply_ip_network 192.168.1.20',
  );
  assert.match(env, /^INITPAD_NETWORK_MODE=ip$/m);
  assert.match(env, /^INITPAD_PUBLIC_URL=http:\/\/192\.168\.1\.20:8090$/m);
  assert.match(env, /^INITPAD_GITEA_PUBLIC_URL=http:\/\/192\.168\.1\.20:3005$/m);
  assert.match(env, /^INITPAD_REGISTRY_HOST=127\.0\.0\.1:3005$/m);
  assert.match(env, /^INITPAD_CI_REGISTRY_HOST=host\.docker\.internal:3005$/m);
  assert.match(env, /^INITPAD_GITEA_RUNNER_URL=http:\/\/host\.docker\.internal:3005$/m);
  assert.match(env, /^INITPAD_DOMAIN=$/m);
  assert.match(env, /^INITPAD_DEPLOY_BIND_ADDRESS=0\.0\.0\.0$/m);
});

test('a quiet re-apply follows changed ports but keeps the bind address (ADR-175)', () => {
  const { env } = runNetworkFunctions(
    'INITPAD_WEB_PORT=8181\nINITPAD_DEPLOY_BIND_ADDRESS=0.0.0.0\n',
    'apply_local_network quiet',
  );
  assert.match(env, /^INITPAD_PUBLIC_URL=http:\/\/localhost:8181$/m);
  assert.match(env, /^INITPAD_DEPLOY_BIND_ADDRESS=0\.0\.0\.0$/m);
  const explicit = runNetworkFunctions('', 'apply_local_network').env;
  assert.match(explicit, /^INITPAD_DEPLOY_BIND_ADDRESS=127\.0\.0\.1$/m);
});

test('accepts only usable IPv4 addresses for --ip', () => {
  const { stdout } = runNetworkFunctions(
    '',
    'for a in 192.168.1.20 10.0.0.5 127.0.0.1 0.0.0.0 256.1.1.1 1.2.3 01.2.3.4 a.b.c.d 224.0.0.1; do valid_ipv4 "$a" && echo "$a"; done; true',
  );
  assert.deepEqual(stdout.trim().split('\n'), ['192.168.1.20', '10.0.0.5']);
});

test('recomputes addresses from the stored network mode on every run', () => {
  const dispatch = installer.slice(
    installer.indexOf('if [ "$ARG_LOCAL" = yes ]; then'),
    installer.indexOf('# Installations configured by hand for the internal CA'),
  );
  assert.match(dispatch, /network_mode=\$\(get_env INITPAD_NETWORK_MODE/);
  assert.match(dispatch, /local\) apply_local_network quiet ;;/);
  assert.match(dispatch, /apply_ip_network "\$current_host" quiet/);
});

test('checks free ports and capacity before starting any service', () => {
  const preflight = installer.indexOf('\ncheck_capacity\ncheck_ports\n');
  assert.ok(preflight > 0);
  assert.ok(preflight < installer.indexOf('$COMPOSE up -d postgres gitea fake-sftp static-web'));
  assert.match(installer, /"INITPAD_STATIC_WEB_PORT=\$static_port"/);
  const compose = readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8');
  assert.match(compose, /- '\$\{INITPAD_STATIC_WEB_PORT:-8085\}:80'/);
});

test('re-runs neither rebuild unchanged images nor restart Gitea without an SSO change', () => {
  assert.match(installer, /build_marker=\.runtime\/source-build\.hash/);
  assert.match(installer, /\$COMPOSE up -d --no-build supervisor api web/);
  assert.doesNotMatch(installer, /up -d --build supervisor api web/);
  const reload = installer.slice(installer.indexOf('sso_marker='), installer.indexOf('# ---- 6.'));
  assert.match(
    reload,
    /if \[ "\$\(cat "\$sso_marker" 2>\/dev\/null\)" != "\$sso_hash" \]; then\n\s+say "Reloading/,
  );
});

test('never passes the Gitea token as a command-line argument', () => {
  const api = installer.slice(
    installer.indexOf('gitea_api() {'),
    installer.indexOf('ensure_action_mirror() {'),
  );
  assert.doesNotMatch(api, /-H "Authorization: token/);
  assert.match(api, /-K \/dev\/fd\/3/);
});

test('touches ufw only for a domain install', () => {
  assert.match(installer, /if \[ -n "\$\{DOMAIN:-\}" \] && systemctl is-active --quiet ufw/);
});

test('serves templates from the API image, not from the checkout', () => {
  const compose = readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8');
  assert.doesNotMatch(compose, /\.\.\/templates:\/templates/);
  assert.match(
    readFileSync(resolve(root, 'apps/api/Dockerfile'), 'utf8'),
    /^COPY templates \/templates$/m,
  );
});

test('reset.sh removes deployed apps, their networks and images', () => {
  const reset = readFileSync(resolve(root, 'deploy/reset.sh'), 'utf8');
  assert.match(reset, /docker ps -aq --filter label=com\.initpad\.managed=true/);
  assert.match(reset, /docker network ls -q --filter label=com\.initpad\.managed=true/);
  assert.match(reset, /\^net-\(\[a-z0-9-\]\+-\)\?\(dev\|test\|prod\)\$/);
  assert.match(reset, /docker image rm -f/);
});

test('the dev stack is a separate Compose project (ADR-175)', () => {
  const dev = readFileSync(resolve(root, 'infra/docker-compose.yml'), 'utf8');
  const deploy = readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8');
  assert.match(dev, /^name: initpad-dev$/m);
  assert.match(deploy, /^name: initpad$/m);
  assert.match(dev, /GITEA__security__INSTALL_LOCK: "true"/);
  assert.doesNotMatch(dev, /"3001:3000"|"8085:80"/);
});
