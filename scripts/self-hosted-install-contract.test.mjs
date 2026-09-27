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
