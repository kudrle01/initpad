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
    installer.indexOf('# ---- 6. runner'),
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
    caddyfile.indexOf('{$INITPAD_DOMAIN} {'),
    caddyfile.indexOf('{$INITPAD_GIT_DOMAIN} {'),
  );

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
  for (const site of ['{$INITPAD_DOMAIN} {', '{$INITPAD_GIT_DOMAIN} {']) {
    const block = caddyfile.slice(caddyfile.indexOf(site));
    assert.match(block, /header Strict-Transport-Security "max-age=31536000"/);
  }
});
