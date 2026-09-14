import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(root, 'deploy/configure-agent-release.sh');
const digest = `registry.example/initpad-agent@sha256:${'a'.repeat(64)}`;

function fixture(env) {
  const directory = mkdtempSync(resolve(tmpdir(), 'initpad-agent-release-'));
  const envFile = resolve(directory, '.env');
  const releaseFile = resolve(directory, 'agent-release.env');
  writeFileSync(envFile, env);
  writeFileSync(
    releaseFile,
    `INITPAD_AGENT_IMAGE=${digest}\nINITPAD_AGENT_RELEASE_VERSION=1.2.3\n`,
  );
  return { envFile, releaseFile };
}

function configure(files, args = []) {
  return execFileSync(script, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      INITPAD_ENV_FILE: files.envFile,
      INITPAD_AGENT_RELEASE_FILE: files.releaseFile,
    },
  });
}

test('fills a blank environment from the reviewed Agent release pair', () => {
  const files = fixture('INITPAD_AGENT_IMAGE=\nINITPAD_AGENT_RELEASE_VERSION=\nKEEP=value\n');

  assert.match(configure(files), /Configured reviewed InitPad Agent 1\.2\.3/);
  assert.equal(
    readFileSync(files.envFile, 'utf8'),
    `INITPAD_AGENT_IMAGE=${digest}\nINITPAD_AGENT_RELEASE_VERSION=1.2.3\nKEEP=value\n`,
  );
  assert.equal(statSync(files.envFile).mode & 0o777, 0o600);
});

test('preserves an explicitly configured complete Agent release pair', () => {
  const oldDigest = `registry.example/initpad-agent@sha256:${'c'.repeat(64)}`;
  const files = fixture(`INITPAD_AGENT_IMAGE=${oldDigest}\nINITPAD_AGENT_RELEASE_VERSION=1.1.0\n`);

  assert.match(configure(files), /Keeping explicitly configured InitPad Agent 1\.1\.0/);
  assert.match(readFileSync(files.envFile, 'utf8'), new RegExp(oldDigest));
});

test('explicitly updates an existing pin to the reviewed Agent release pair', () => {
  const oldDigest = `registry.example/initpad-agent@sha256:${'c'.repeat(64)}`;
  const files = fixture(
    `INITPAD_AGENT_IMAGE=${oldDigest}\nKEEP=value\nINITPAD_AGENT_RELEASE_VERSION=1.1.0\n`,
  );

  assert.match(configure(files, ['--update']), /Updated reviewed InitPad Agent release to 1\.2\.3/);
  assert.equal(
    readFileSync(files.envFile, 'utf8'),
    `INITPAD_AGENT_IMAGE=${digest}\nKEEP=value\nINITPAD_AGENT_RELEASE_VERSION=1.2.3\n`,
  );
  assert.equal(statSync(files.envFile).mode & 0o777, 0o600);
});

test('rejects a partial Agent release pair instead of guessing', () => {
  const files = fixture(`INITPAD_AGENT_IMAGE=${digest}\nINITPAD_AGENT_RELEASE_VERSION=\n`);

  assert.throws(
    () => configure(files),
    /INITPAD_AGENT_IMAGE and INITPAD_AGENT_RELEASE_VERSION must be configured together/,
  );
});
