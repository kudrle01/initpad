import assert from 'node:assert/strict';
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const compose = readFileSync('deploy/saas.compose.yml', 'utf8');
const checker = readFileSync('deploy/saas-check.sh', 'utf8');
const example = readFileSync('deploy/.env.saas.example', 'utf8');

test('keeps the SaaS runtime separate from bundled self-hosted dependencies', () => {
  const services = compose.slice(compose.indexOf('services:'), compose.indexOf('\nvolumes:'));
  const serviceNames = [...services.matchAll(/^ {2}([a-z][a-z0-9-]+):$/gm)].map(
    (match) => match[1],
  );

  assert.deepEqual(serviceNames, ['api', 'web']);
  assert.doesNotMatch(services, /gitea|mini[o]|act_runner|runner-docker|fake-sftp|fake-vps/i);
  assert.doesNotMatch(compose, /docker\.sock/);
  assert.match(compose, /INITPAD_EDITION: saas/);
  assert.match(compose, /DATABASE_URL_FILE: \/run\/secrets\/database_url/);
  assert.match(compose, /INITPAD_ARTIFACT_S3_BUCKET:\?set the private external bucket/);
  assert.match(compose, /INITPAD_OTEL_ENABLED: 'true'/);
  assert.match(
    compose,
    /OTEL_EXPORTER_OTLP_ENDPOINT:\?set the private OTLP HTTP collector endpoint/,
  );
  assert.match(compose, /INITPAD_TRUST_PROXY_HOPS:\?set to 2 for public edge plus web proxy/);
  assert.match(example, /^OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/otel-collector:4318$/m);
  assert.match(example, /^INITPAD_TRUST_PROXY_HOPS=2$/m);
});

test('requires immutable platform images and validates without printing secrets', () => {
  assert.match(compose, /INITPAD_API_IMAGE:\?set_digest_pinned_api_image/);
  assert.match(compose, /INITPAD_WEB_IMAGE:\?set_digest_pinned_web_image/);
  assert.match(checker, /config --quiet/);
  assert.match(checker, /config --services/);
  assert.match(checker, /@sha256:/);
  assert.doesNotMatch(checker, /\bcat\b|\bset -x\b/);
  assert.doesNotMatch(checker, /(^|\s)(source|\.)\s+["']?\$env_file/m);
});

test('hardens both services while leaving the web proxy able to start', () => {
  const services = compose.slice(compose.indexOf('services:'), compose.indexOf('\nvolumes:'));
  const api = services.slice(services.indexOf('\n  api:'), services.indexOf('\n  web:'));
  const web = services.slice(services.indexOf('\n  web:'));

  for (const [name, service] of [
    ['api', api],
    ['web', web],
  ]) {
    assert.match(service, /^ {4}read_only: true$/m, name);
    assert.match(service, /^ {4}cap_drop: \[ALL\]$/m, name);
    assert.match(service, /^ {4}security_opt: \[no-new-privileges:true\]$/m, name);
    assert.doesNotMatch(service, /privileged|^ {4}user: ['"]?(0|root)\b/m, name);
  }
  // The web image runs nginx unprivileged (ADR-144); neither service gets a
  // capability back.
  assert.doesNotMatch(web, /cap_add/);
  assert.doesNotMatch(api, /cap_add/);
});

test('mounts deployment-owned secrets as files without placing values in the environment', () => {
  const secretNames = [
    'DATABASE_URL',
    'INITPAD_JWT_SECRET',
    'INITPAD_ENCRYPTION_KEY',
    'INITPAD_GITHUB_CLIENT_SECRET',
    'INITPAD_GITHUB_PRIVATE_KEY',
    'INITPAD_GITHUB_WEBHOOK_SECRET',
    'INITPAD_ARTIFACT_S3_ACCESS_KEY_ID',
    'INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY',
    'INITPAD_SMTP_PASSWORD',
  ];

  for (const name of secretNames) {
    const deploymentName = name === 'DATABASE_URL' ? 'INITPAD_DATABASE_URL' : name;
    assert.match(compose, new RegExp(`${name}_FILE: /run/secrets/`));
    assert.doesNotMatch(compose, new RegExp(`^ {6}${name}:`, 'm'));
    assert.match(example, new RegExp(`^${deploymentName}_FILE=/secure/runtime/secrets/`, 'm'));
    assert.doesNotMatch(example, new RegExp(`^${deploymentName}=`, 'm'));
  }
  // SaaS runs no Gitea, so neither its OIDC client nor its webhook secret exists
  // there (ADR-153).
  assert.doesNotMatch(
    compose,
    /SCM_WEBHOOK_TOKEN|OIDC_CLIENT_SECRET|scm_webhook_token|oidc_client_secret/,
  );
  assert.doesNotMatch(example, /SCM_WEBHOOK_TOKEN|OIDC_CLIENT_SECRET/);
  assert.doesNotMatch(example, /EXTERNAL_SECRET|__GENERATE__/);
  assert.match(example, /INITPAD_WEB_BIND_ADDRESS=127\.0\.0\.1/);
});

const secretFileVariables = [
  'INITPAD_DATABASE_URL_FILE',
  'INITPAD_JWT_SECRET_FILE',
  'INITPAD_ENCRYPTION_KEY_FILE',
  'INITPAD_SMTP_PASSWORD_FILE',
  'INITPAD_GITHUB_CLIENT_SECRET_FILE',
  'INITPAD_GITHUB_PRIVATE_KEY_FILE',
  'INITPAD_GITHUB_WEBHOOK_SECRET_FILE',
  'INITPAD_ARTIFACT_S3_ACCESS_KEY_ID_FILE',
  'INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY_FILE',
];

function acceptanceFixture(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'initpad-saas-check-'));
  const binDirectory = join(directory, 'bin');
  const secretDirectory = join(directory, 'secrets');
  mkdirSync(binDirectory);
  mkdirSync(secretDirectory);

  const docker = join(binDirectory, 'docker');
  writeFileSync(
    docker,
    `#!/bin/sh
case "$*" in
  *"config --quiet") exit 0 ;;
  *"config --services") printf 'api\\nweb\\n' ;;
  *"config --images")
    printf '%s\\n' \\
      'ghcr.io/example/initpad-api@sha256:${'a'.repeat(64)}' \\
      'ghcr.io/example/initpad-web@sha256:${'b'.repeat(64)}'
    ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(docker, 0o755);

  const values = {
    INITPAD_PUBLIC_URL: 'https://initpad.test.example.org',
    INITPAD_PLATFORM_VERSION: '0.2.10',
    INITPAD_API_IMAGE: `ghcr.io/example/initpad-api@sha256:${'a'.repeat(64)}`,
    INITPAD_WEB_IMAGE: `ghcr.io/example/initpad-web@sha256:${'b'.repeat(64)}`,
    INITPAD_AGENT_IMAGE: `ghcr.io/example/initpad-agent@sha256:${'c'.repeat(64)}`,
    INITPAD_AGENT_RELEASE_VERSION: '0.14.3',
    INITPAD_ARTIFACT_S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
    INITPAD_ARTIFACT_S3_BUCKET: 'initpad-staging-artifacts',
    INITPAD_SMTP_HOST: 'smtp.tem.scaleway.com',
    INITPAD_SMTP_USERNAME: 'project-id',
    INITPAD_SMTP_FROM: 'InitPad <no-reply@test.example.org>',
    INITPAD_GITHUB_APP_ID: '12345',
    INITPAD_GITHUB_CLIENT_ID: 'Iv1.client',
    INITPAD_GITHUB_APP_SLUG: 'initpad-staging',
    INITPAD_TRUST_PROXY_HOPS: '2',
    INITPAD_WEB_BIND_ADDRESS: '127.0.0.1',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
  };

  for (const variable of secretFileVariables) {
    const secretFile = join(secretDirectory, variable.toLowerCase());
    writeFileSync(secretFile, 'fixture-secret\n', { mode: 0o600 });
    values[variable] = secretFile;
  }
  Object.assign(values, overrides);

  const envFile = join(directory, 'saas.env');
  writeFileSync(
    envFile,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    { mode: 0o600 },
  );
  return { binDirectory, envFile, values };
}

function runChecker(fixture) {
  return spawnSync('sh', ['deploy/saas-check.sh', fixture.envFile], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fixture.binDirectory}:${process.env.PATH}` },
  });
}

test('accepts a complete SaaS preflight without printing secret values', () => {
  const fixture = acceptanceFixture();
  const result = runChecker(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SaaS Compose contract is valid/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fixture-secret/);
});

test('rejects unsafe SaaS URLs, placeholders and direct secrets before Compose', () => {
  for (const [overrides, message] of [
    [{ INITPAD_PUBLIC_URL: 'http://initpad.test.example.org' }, /must use HTTPS/],
    [{ INITPAD_PUBLIC_URL: 'https://initpad.test.example.org/path' }, /without a path/],
    [{ INITPAD_GITHUB_APP_ID: 'REPLACE' }, /placeholder in INITPAD_GITHUB_APP_ID/],
    [{ DATABASE_URL: 'postgresql://secret' }, /must be supplied through its _FILE/],
    [{ INITPAD_TRUST_PROXY_HOPS: '1' }, /must be 2 for public edge/],
    [{ INITPAD_TRUST_PROXY_HOPS: '3' }, /must be 2 for public edge/],
    [{ INITPAD_WEB_BIND_ADDRESS: '0.0.0.0' }, /must be 127\.0\.0\.1/],
  ]) {
    const fixture = acceptanceFixture(overrides);
    const result = runChecker(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fixture-secret/);
  }

  const duplicateFixture = acceptanceFixture();
  appendFileSync(
    duplicateFixture.envFile,
    'INITPAD_PUBLIC_URL=https://different.test.example.org\n',
  );
  const duplicateResult = runChecker(duplicateFixture);
  assert.notEqual(duplicateResult.status, 0);
  assert.match(duplicateResult.stderr, /duplicate keys: INITPAD_PUBLIC_URL/);
});

test('rejects missing, relative, empty and checkout-local secret files', () => {
  const cases = [
    ['/missing/initpad-secret', /does not point to a regular file/],
    ['relative-secret', /must contain an absolute path/],
  ];
  for (const [value, message] of cases) {
    const fixture = acceptanceFixture({ INITPAD_JWT_SECRET_FILE: value });
    const result = runChecker(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }

  const fixture = acceptanceFixture();
  const emptySecret = join(tmpdir(), `initpad-empty-secret-${process.pid}`);
  writeFileSync(emptySecret, '', { mode: 0o600 });
  const emptyValues = readFileSync(fixture.envFile, 'utf8').replace(
    /^INITPAD_JWT_SECRET_FILE=.*$/m,
    `INITPAD_JWT_SECRET_FILE=${emptySecret}`,
  );
  writeFileSync(fixture.envFile, emptyValues, { mode: 0o600 });
  const emptyResult = runChecker(fixture);
  assert.notEqual(emptyResult.status, 0);
  assert.match(emptyResult.stderr, /points to an empty file/);

  const checkoutSecret = join(process.cwd(), '.saas-check-secret-fixture');
  const linkedSecret = join(tmpdir(), `initpad-linked-secret-${process.pid}`);
  writeFileSync(checkoutSecret, 'not-a-real-secret\n', { mode: 0o600 });
  symlinkSync(checkoutSecret, linkedSecret);
  try {
    const localValues = readFileSync(fixture.envFile, 'utf8').replace(
      /^INITPAD_JWT_SECRET_FILE=.*$/m,
      `INITPAD_JWT_SECRET_FILE=${checkoutSecret}`,
    );
    writeFileSync(fixture.envFile, localValues, { mode: 0o600 });
    const localResult = runChecker(fixture);
    assert.notEqual(localResult.status, 0);
    assert.match(localResult.stderr, /must point outside the source checkout/);

    const linkedValues = readFileSync(fixture.envFile, 'utf8').replace(
      /^INITPAD_JWT_SECRET_FILE=.*$/m,
      `INITPAD_JWT_SECRET_FILE=${linkedSecret}`,
    );
    writeFileSync(fixture.envFile, linkedValues, { mode: 0o600 });
    const linkedResult = runChecker(fixture);
    assert.notEqual(linkedResult.status, 0);
    assert.match(linkedResult.stderr, /must not point to a symbolic link/);
  } finally {
    unlinkSync(checkoutSecret);
    unlinkSync(linkedSecret);
  }
});
