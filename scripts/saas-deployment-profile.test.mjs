import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
});

test('requires immutable platform images and validates without printing secrets', () => {
  assert.match(compose, /INITPAD_API_IMAGE:\?set_digest_pinned_api_image/);
  assert.match(compose, /INITPAD_WEB_IMAGE:\?set_digest_pinned_web_image/);
  assert.match(checker, /config --quiet/);
  assert.match(checker, /config --services/);
  assert.match(checker, /@sha256:/);
  assert.doesNotMatch(checker, /\bcat\b|\bset -x\b/);
});

test('mounts deployment-owned secrets as files without placing values in the environment', () => {
  const secretNames = [
    'DATABASE_URL',
    'INITPAD_JWT_SECRET',
    'INITPAD_ENCRYPTION_KEY',
    'INITPAD_SCM_WEBHOOK_TOKEN',
    'INITPAD_OIDC_CLIENT_SECRET',
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
  assert.doesNotMatch(example, /EXTERNAL_SECRET|__GENERATE__/);
  assert.match(example, /INITPAD_WEB_BIND_ADDRESS=127\.0\.0\.1/);
});
