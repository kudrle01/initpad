/* eslint-disable no-console */
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { isAbsolute } = require('node:path');

const fileBackedSecrets = [
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

function fail(message) {
  console.error(`initpad-api: ${message}`);
  process.exit(1);
}

function loadFileBackedSecrets() {
  for (const name of fileBackedSecrets) {
    const fileName = `${name}_FILE`;
    const directValue = process.env[name];
    const filePath = process.env[fileName];

    if (!filePath) continue;
    if (directValue) {
      fail(`${name} and ${fileName} cannot both be set`);
    }
    if (!isAbsolute(filePath)) {
      fail(`${fileName} must be an absolute path`);
    }

    let value;
    try {
      value = readFileSync(filePath, 'utf8').replace(/(?:\r?\n)+$/, '');
    } catch {
      fail(`${fileName} cannot be read`);
    }

    if (!value) fail(`${fileName} is empty`);
    if (value.includes('\0')) fail(`${fileName} contains a NUL byte`);

    process.env[name] = value;
    delete process.env[fileName];
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) fail('a command is required');

  loadFileBackedSecrets();
  const child = spawn(command, args, {
    env: process.env,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', () => fail('the application command could not be started'));
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main();
