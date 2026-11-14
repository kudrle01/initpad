#!/usr/bin/env node
// Validates the self-hosted Compose stack the way install.sh renders it: the
// documented .env.example, the platform-release override the Supervisor
// writes, and the values install.sh generates. CI, README and CONTRIBUTING all
// run this one script, so a clean checkout and CI check the same thing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const deploy = join(root, 'deploy');
const override = join(deploy, '.runtime/platform-update/platform-release.override.yml');

// Every profile is validated: a service that only exists behind a profile is
// otherwise never rendered before an operator enables it.
const runs = [[], ['--profile', 'runner'], ['--profile', 'server']];

const environment = {
  ...process.env,
  INITPAD_INSTALL_ROOT: root,
  INITPAD_SUPERVISOR_SHARED_SECRET: 'check-only-supervisor-secret-000000000000',
};

// Remove afterwards exactly what this check created, never an operator's file.
let created = existsSync(override) ? undefined : override;
for (let directory = dirname(override); !existsSync(directory); directory = dirname(directory)) {
  created = directory;
}
if (created) {
  mkdirSync(dirname(override), { recursive: true });
  writeFileSync(override, 'services: {}\n');
}

let status = 0;
try {
  for (const profile of runs) {
    const args = ['compose', '--env-file', '.env.example', ...profile, 'config', '--quiet'];
    const result = spawnSync('docker', args, { cwd: deploy, env: environment, stdio: 'inherit' });
    if (result.error) {
      console.error(`check:compose: cannot run docker: ${result.error.message}`);
      status = 1;
      break;
    }
    if (result.status !== 0) {
      console.error(`check:compose: docker ${args.join(' ')} failed`);
      status = result.status ?? 1;
      break;
    }
  }
} finally {
  if (created) rmSync(created, { recursive: true });
}
process.exit(status);
