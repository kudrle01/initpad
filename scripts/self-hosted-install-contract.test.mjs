import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
