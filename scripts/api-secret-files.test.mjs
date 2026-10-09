import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = resolve('apps/api/scripts/run-with-secrets.js');
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
  'INITPAD_BOOTSTRAP_TOKEN',
];

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of secretNames) {
    delete env[name];
    delete env[`${name}_FILE`];
  }
  return { ...env, ...overrides };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(env, child = ['-e', 'process.exit(0)']) {
  return spawnSync(process.execPath, [runner, process.execPath, ...child], {
    encoding: 'utf8',
    env: cleanEnvironment(env),
  });
}

test('loads secret files before the application and removes file pointers', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'initpad-api-secrets-'));
  const databaseUrl = 'postgresql://database.example/initpad';
  const privateKey = [
    '-----BEGIN',
    'PRIVATE KEY-----\nline-one\nline-two\n-----END PRIVATE KEY-----',
  ].join(' ');
  const databaseFile = resolve(directory, 'database-url');
  const privateKeyFile = resolve(directory, 'github-private-key');
  writeFileSync(databaseFile, `${databaseUrl}\n`);
  writeFileSync(privateKeyFile, `${privateKey}\r\n`);

  const script = `
    const { createHash } = require('node:crypto');
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    console.log(JSON.stringify({
      database: hash(process.env.DATABASE_URL),
      privateKey: hash(process.env.INITPAD_GITHUB_PRIVATE_KEY),
      pointersRemoved:
        !process.env.DATABASE_URL_FILE && !process.env.INITPAD_GITHUB_PRIVATE_KEY_FILE,
    }));
  `;
  const result = run(
    {
      DATABASE_URL_FILE: databaseFile,
      INITPAD_GITHUB_PRIVATE_KEY_FILE: privateKeyFile,
    },
    ['-e', script],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    database: sha256(databaseUrl),
    privateKey: sha256(privateKey),
    pointersRemoved: true,
  });
  assert.doesNotMatch(result.stdout, /database\.example|BEGIN PRIVATE KEY/);
});

test('rejects ambiguous, relative, empty and binary secret input without leaking it', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'initpad-api-secrets-invalid-'));
  const validFile = resolve(directory, 'valid');
  const emptyFile = resolve(directory, 'empty');
  const binaryFile = resolve(directory, 'binary');
  writeFileSync(validFile, 'file-secret');
  writeFileSync(emptyFile, '');
  writeFileSync(binaryFile, 'private-before-nul\0private-after-nul');

  const cases = [
    {
      env: { INITPAD_JWT_SECRET: 'direct-secret', INITPAD_JWT_SECRET_FILE: validFile },
      message: /cannot both be set/,
    },
    { env: { INITPAD_JWT_SECRET_FILE: 'relative-secret' }, message: /absolute path/ },
    { env: { INITPAD_JWT_SECRET_FILE: emptyFile }, message: /is empty/ },
    { env: { INITPAD_JWT_SECRET_FILE: binaryFile }, message: /contains a NUL byte/ },
  ];

  for (const entry of cases) {
    const result = run(entry.env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, entry.message);
    assert.doesNotMatch(result.stderr, /direct-secret|file-secret|private-before-nul/);
  }
});

test('keeps direct self-hosted values and propagates the application exit code', () => {
  const result = run({ INITPAD_JWT_SECRET: 'existing-self-hosted-value' }, [
    '-e',
    'process.exit(process.env.INITPAD_JWT_SECRET ? 23 : 24)',
  ]);

  assert.equal(result.status, 23);
});
