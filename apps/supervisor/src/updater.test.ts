import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadState, saveState } from './state.js';
import type { PlatformReleaseManifest, SupervisorState } from './types.js';
import { PlatformUpdater, type CommandResult, type CommandRunner, writePlan } from './updater.js';

const operationId = '8617bbb8-896d-46bb-9db7-afdc081b2b91';
const requestId = '3f04ebec-3299-4ce5-bd02-cf390ca413e9';

function manifest(): PlatformReleaseManifest {
  const image = (component: string, letter: string) => ({
    name: `ghcr.io/example/initpad-${component}`,
    digest: `sha256:${letter.repeat(64)}`,
    immutableReference: `ghcr.io/example/initpad-${component}@sha256:${letter.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  });
  const value = {
    schemaVersion: 1 as const,
    component: 'initpad-platform' as const,
    version: '0.3.0',
    source: {
      repository: 'https://github.com/example/initpad',
      tag: 'initpad-v0.3.0',
      commit: 'd'.repeat(40),
    },
    images: {
      api: image('api', 'a'),
      web: image('web', 'b'),
      supervisor: image('supervisor', 'c'),
    },
    compose: { file: 'initpad-release.override.yml' as const, sha256: '' },
    database: {
      migrationMode: 'expand-contract' as const,
      rollback: 'image-compatible' as const,
      backupRequired: true as const,
    },
  };
  const override = [
    'services:',
    '  api:',
    `    image: ${JSON.stringify(value.images.api.immutableReference)}`,
    '    environment:',
    '      INITPAD_PLATFORM_VERSION: "0.3.0"',
    '  web:',
    `    image: ${JSON.stringify(value.images.web.immutableReference)}`,
    '  supervisor:',
    `    image: ${JSON.stringify(value.images.supervisor.immutableReference)}`,
    '    environment:',
    '      INITPAD_PLATFORM_VERSION: "0.3.0"',
    '',
  ].join('\n');
  value.compose.sha256 = createHash('sha256').update(override).digest('hex');
  return value;
}

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];
  failWeb = false;
  failHelperRun = false;
  supervisorImageId = `sha256:${'f'.repeat(64)}`;
  supervisorConfiguredImage = `ghcr.io/example/initpad-supervisor@sha256:${'e'.repeat(64)}`;

  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push([command, ...args]);
    if (this.failWeb && args.includes('up') && args.at(-1) === 'web') {
      throw new Error('web failed readiness');
    }
    if (command === 'docker' && args[0] === 'run' && this.failHelperRun) {
      throw new Error('helper image unavailable');
    }
    if (
      command === 'docker' &&
      args[0] === 'inspect' &&
      args.includes('{{.Image}}\n{{.Config.Image}}')
    ) {
      return {
        stdout: `${this.supervisorImageId}\n${this.supervisorConfiguredImage}`,
        stderr: '',
      };
    }
    if (command === 'docker' && args[0] === 'ps') return { stdout: '', stderr: '' };
    if (args.includes('ps') && args.includes('-q')) return { stdout: 'a'.repeat(64), stderr: '' };
    if (command === 'docker' && args[0] === 'inspect') {
      return { stdout: 'healthy', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  }

  async outputToFile(command: string, args: string[], outputFile: string): Promise<CommandResult> {
    this.calls.push([command, ...args]);
    await writeFile(outputFile, 'verified backup', { flag: 'wx' });
    return { stdout: '', stderr: '' };
  }
}

test('launches the helper from the running release immutable reference', async () => {
  const { directory, plan } = await fixture();
  try {
    const runner = new FakeRunner();
    await new PlatformUpdater(runner).launchHelper(plan);
    const launch = runner.calls.find((call) => call[0] === 'docker' && call[1] === 'run');
    assert.ok(launch);
    assert.ok(launch.includes(runner.supervisorConfiguredImage));
    assert.equal(launch.includes(runner.supervisorImageId), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pins source helpers to the exact local image ID and removes a rejected plan', async () => {
  const { directory, plan } = await fixture();
  try {
    const runner = new FakeRunner();
    runner.supervisorConfiguredImage = 'initpad-supervisor:source';
    runner.failHelperRun = true;
    await assert.rejects(new PlatformUpdater(runner).launchHelper(plan), /image unavailable/);
    const launch = runner.calls.find((call) => call[0] === 'docker' && call[1] === 'run');
    assert.ok(launch?.includes(runner.supervisorImageId));
    await assert.rejects(readFile(plan), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'initpad-supervisor-'));
  const root = resolve(directory, 'install');
  await mkdir(resolve(root, 'deploy'), { recursive: true });
  await writeFile(resolve(root, 'deploy/.env'), 'INITPAD_TEST=true\n');
  process.env.INITPAD_SUPERVISOR_STATE_DIR = resolve(directory, 'state');
  process.env.INITPAD_INSTALL_ROOT = root;
  const state: SupervisorState = {
    schemaVersion: 1,
    currentVersion: '0.2.0',
    currentImages: null,
    operation: {
      id: operationId,
      requestId,
      fromVersion: '0.2.0',
      toVersion: '0.3.0',
      status: 'accepted',
      stage: 'accepted',
      message: 'accepted',
      backupPath: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
  };
  await saveState(state);
  const plan = await writePlan(operationId, {
    version: '0.3.0',
    manifestBase64: Buffer.from('{}').toString('base64'),
    bundle: {},
  });
  return { directory, plan };
}

test('updates API, web and Supervisor from immutable images after a verified backup', async () => {
  const { directory, plan } = await fixture();
  try {
    const runner = new FakeRunner();
    const updater = new PlatformUpdater(
      runner,
      (async () => manifest()) as never,
      async () => undefined,
    );
    await updater.applyPlan(plan);
    const state = await loadState();
    assert.equal(state.currentVersion, '0.3.0');
    assert.equal(state.operation?.status, 'succeeded');
    assert.equal(state.currentImages?.api, manifest().images.api.immutableReference);
    const runtime = resolve(directory, 'state/runtime');
    const [runtimeStat, overrideStat] = await Promise.all([
      stat(runtime),
      stat(resolve(runtime, 'platform-release.override.yml')),
    ]);
    assert.equal(overrideStat.uid, runtimeStat.uid);
    assert.equal(overrideStat.gid, runtimeStat.gid);
    assert.equal(overrideStat.mode & 0o777, 0o600);
    const commands = runner.calls.map((call) => call.join(' ')).join('\n');
    assert.match(commands, /pg_dump/);
    assert.match(commands, /pg_restore --list/);
    assert.match(commands, /pull ghcr\.io\/example\/initpad-api@sha256:/);
    assert.match(commands, /up -d --no-deps --no-build supervisor/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restores the previous version and records a rollback when switching fails', async () => {
  const { directory, plan } = await fixture();
  try {
    const runner = new FakeRunner();
    runner.failWeb = true;
    const updater = new PlatformUpdater(
      runner,
      (async () => manifest()) as never,
      async () => undefined,
    );
    await assert.rejects(updater.applyPlan(plan), /web failed readiness/);
    const state = await loadState();
    assert.equal(state.currentVersion, '0.2.0');
    assert.equal(state.currentImages, null);
    assert.equal(state.operation?.status, 'rolled-back');
    assert.match(state.operation?.message ?? '', /web failed readiness/);
    await assert.rejects(readFile(plan), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not alter the active release override when a plan is invalid', async () => {
  const { directory, plan } = await fixture();
  try {
    const runtime = resolve(directory, 'state/runtime');
    const override = resolve(runtime, 'platform-release.override.yml');
    await mkdir(runtime, { recursive: true });
    await writeFile(override, 'services: {}\n');
    await writeFile(plan, '{invalid json\n');

    await assert.rejects(new PlatformUpdater(new FakeRunner()).applyPlan(plan), /Expected|JSON/);
    assert.equal(await readFile(override, 'utf8'), 'services: {}\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovers an orphaned mid-switch operation after a host restart', async () => {
  const { directory } = await fixture();
  try {
    const state = await loadState();
    if (!state.operation) throw new Error('fixture operation is missing');
    state.operation.status = 'running';
    state.operation.stage = 'api';
    await saveState(state);
    await mkdir(resolve(directory, 'state/runtime'), { recursive: true });
    await writeFile(
      resolve(directory, 'state/runtime/platform-release.override.yml'),
      'services:\n  api:\n    image: "candidate"\n',
    );
    const runner = new FakeRunner();
    await new PlatformUpdater(runner).recoverInterruptedUpdate();

    const recovered = await loadState();
    assert.equal(recovered.currentVersion, '0.2.0');
    assert.equal(recovered.operation?.status, 'rolled-back');
    const commands = runner.calls.map((call) => call.join(' ')).join('\n');
    assert.match(commands, /up -d --no-deps --no-build api web/);
    assert.doesNotMatch(commands, /up -d --no-deps --no-build api web supervisor/);
    await assert.rejects(
      readFile(resolve(directory, 'state/runtime/platform-release.override.yml')),
      /ENOENT/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
