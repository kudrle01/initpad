import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, 'deploy/gateway', path), 'utf8');
const compose = read('docker-compose.yml');
const caddyfile = read('Caddyfile');

function service(name) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `service ${name} is missing`);
  const rest = compose.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z-]+:\n|\n[a-z]+:\n/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

test('pins every gateway image by digest', () => {
  const images = [...compose.matchAll(/^\s+image: (\S+)$/gm)].map((match) => match[1]);
  assert.equal(images.length, 3);
  for (const image of images) assert.match(image, /@sha256:[a-f0-9]{64}$/);
});

test('hardens every gateway container and gives the gateway no Docker socket', () => {
  for (const name of ['ca', 'edge', 'gateway']) {
    const block = service(name);
    assert.match(block, /read_only: true/, `${name} is writable`);
    assert.match(block, /cap_drop: \[ALL\]/, `${name} keeps capabilities`);
    assert.match(block, /no-new-privileges:true/, `${name} may gain privileges`);
    assert.match(block, /mem_limit:/, `${name} has no memory limit`);
    // The binaries carry file capabilities; without this the kernel refuses to run them.
    assert.match(block, /cap_add: \[NET_BIND_SERVICE\]/, `${name} cannot start`);
  }
  assert.doesNotMatch(compose, /docker\.sock/);
});

test('publishes only the edge and labels the inner gateway for the Agent', () => {
  assert.doesNotMatch(service('gateway'), /ports:/);
  assert.doesNotMatch(service('ca'), /ports:/);
  assert.match(service('edge'), /'443:443'/);
  assert.match(service('gateway'), /container_name: initpad-gateway/);
  assert.match(service('gateway'), /com\.initpad\.gateway: 'true'/);
});

test('only certifies the gateway zone and trusts only the configured CA', () => {
  assert.match(caddyfile, /on_demand_tls\s*\{\s*ask http:\/\/127\.0\.0\.1:5555\/allowed/);
  assert.match(caddyfile, /bind 127\.0\.0\.1/);
  assert.match(caddyfile, /endsWith\('\.\{\$GATEWAY_DOMAIN\}'\)/);
  assert.match(caddyfile, /cert_issuer acme\s*\{[\s\S]*?trusted_roots \/etc\/caddy\/ca-root\.crt/);
  assert.match(caddyfile, /admin off/);
});

test('keeps the inner gateway HTTP-only with a private admin socket', () => {
  const inner = JSON.parse(read('inner.json'));
  assert.match(inner.admin.listen, /^unix\/\/run\/initpad-gateway\/admin\.sock\|0200$/);
  assert.equal(inner.apps.http.servers.initpad.automatic_https.disable, true);
});

test('setup validates the zone, warns about .local and never prints secrets', () => {
  const setup = read('setup.sh');
  assert.match(setup, /GATEWAY_DOMAIN in \.env must be a lower-case DNS name/);
  assert.match(setup, /ends in \.local, which is reserved for mDNS/);
  assert.doesNotMatch(setup, /cat secrets\/ca_password|echo .*ca_password/);
  assert.match(setup, /umask 077/);
});
