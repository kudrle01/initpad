import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { asSignedPlatformRelease, verifyPlatformRelease } from './release.js';
import { loadState, saveState, stateDirectory } from './state.js';
import type {
  PlatformReleaseManifest,
  SignedPlatformRelease,
  SupervisorState,
  UpdateOperation,
  UpdatePlan,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const IMMUTABLE_IMAGE = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const MAX_OUTPUT_BYTES = 1024 * 1024;

function updateLock(): string {
  return resolve(stateDirectory(), 'update.lock');
}

function runtimeOverride(): string {
  return resolve(stateDirectory(), 'runtime/platform-release.override.yml');
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: { inputFile?: string }): Promise<CommandResult>;
  outputToFile(command: string, args: string[], outputFile: string): Promise<CommandResult>;
}

type ReleaseVerifier = typeof verifyPlatformRelease;
type Wait = (milliseconds: number) => Promise<void>;

class ProcessRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options: { inputFile?: string } = {},
  ): Promise<CommandResult> {
    const child = spawn(command, args, {
      stdio: [options.inputFile ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
    });
    if (options.inputFile && child.stdin) {
      createReadStream(options.inputFile).pipe(child.stdin);
    }
    return collect(child, `${command} ${args[0] ?? ''}`);
  }

  async outputToFile(command: string, args: string[], outputFile: string): Promise<CommandResult> {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
    });
    const output = createWriteStream(outputFile, { flags: 'wx', mode: 0o600 });
    child.stdout?.pipe(output);
    const outputFinished = finished(output);
    const result = await collect(child, `${command} ${args[0] ?? ''}`, false);
    await outputFinished;
    await chmod(outputFile, 0o600);
    return result;
  }
}

async function collect(
  child: ReturnType<typeof spawn>,
  label: string,
  collectStdout = true,
): Promise<CommandResult> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let size = 0;
  const append = (target: Buffer[], chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_OUTPUT_BYTES) child.kill('SIGKILL');
    else target.push(chunk);
  };
  if (collectStdout) child.stdout?.on('data', (chunk: Buffer) => append(stdout, chunk));
  child.stderr?.on('data', (chunk: Buffer) => append(stderr, chunk));
  const [code] = (await once(child, 'close')) as [number | null];
  const result = {
    stdout: Buffer.concat(stdout).toString('utf8').trim(),
    stderr: Buffer.concat(stderr).toString('utf8').trim(),
  };
  if (size > MAX_OUTPUT_BYTES) throw new Error(`${label} produced too much output`);
  if (code !== 0) {
    throw new Error(`${label} failed${result.stderr ? `: ${result.stderr.slice(0, 500)}` : ''}`);
  }
  return result;
}

function renderOverride(manifest: PlatformReleaseManifest): string {
  const quoted = (value: string) => JSON.stringify(value);
  return [
    'services:',
    '  api:',
    `    image: ${quoted(manifest.images.api.immutableReference)}`,
    '    environment:',
    `      INITPAD_PLATFORM_VERSION: ${quoted(manifest.version)}`,
    '  web:',
    `    image: ${quoted(manifest.images.web.immutableReference)}`,
    '  supervisor:',
    `    image: ${quoted(manifest.images.supervisor.immutableReference)}`,
    '    environment:',
    `      INITPAD_PLATFORM_VERSION: ${quoted(manifest.version)}`,
    '',
  ].join('\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validInstallRoot(): string {
  const value = process.env.INITPAD_INSTALL_ROOT;
  if (!value || value.includes('\0') || value.includes('\n') || !value.startsWith('/')) {
    throw new Error('INITPAD_INSTALL_ROOT must be an absolute host path');
  }
  return resolve(value);
}

function composeArgs(installRoot: string, withOverride: boolean): string[] {
  const deploy = resolve(installRoot, 'deploy');
  const args = [
    'compose',
    '--project-directory',
    deploy,
    '--env-file',
    resolve(deploy, '.env'),
    '-f',
    resolve(deploy, 'docker-compose.yml'),
  ];
  if (withOverride) args.push('-f', runtimeOverride());
  return args;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function updateOperation(
  operation: UpdateOperation,
  patch: Partial<UpdateOperation>,
): Promise<UpdateOperation> {
  Object.assign(operation, patch);
  const state = await loadState();
  state.operation = operation;
  await saveState(state);
  return operation;
}

export function planPath(operationId: string): string {
  if (!UUID.test(operationId)) throw new Error('Platform update operation id is invalid');
  return resolve(stateDirectory(), `update-${operationId}.json`);
}

export async function writePlan(
  operationId: string,
  release: SignedPlatformRelease,
): Promise<string> {
  const path = planPath(operationId);
  const plan: UpdatePlan = {
    schemaVersion: 1,
    operationId,
    release,
    createdAt: new Date().toISOString(),
  };
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(plan)}\n`, { flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

async function readPlan(path: string): Promise<UpdatePlan> {
  if (dirname(resolve(path)) !== stateDirectory()) {
    throw new Error('Platform update plan path is invalid');
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Platform update plan must be a mode-0600 regular file');
  }
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw new Error('Platform update plan is too large');
  const plan = JSON.parse(raw) as UpdatePlan;
  if (
    plan.schemaVersion !== 1 ||
    !UUID.test(plan.operationId) ||
    path !== planPath(plan.operationId) ||
    !Number.isFinite(Date.parse(plan.createdAt))
  ) {
    throw new Error('Platform update plan is invalid');
  }
  plan.release = asSignedPlatformRelease(plan.release);
  return plan;
}

export class PlatformUpdater {
  constructor(
    private readonly runner: CommandRunner = new ProcessRunner(),
    private readonly verifyRelease: ReleaseVerifier = verifyPlatformRelease,
    private readonly wait: Wait = (milliseconds) =>
      new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
  ) {}

  async launchHelper(plan: string): Promise<void> {
    const container = process.env.INITPAD_SUPERVISOR_CONTAINER_NAME || 'initpad-supervisor';
    const identity = (
      await this.runner.run('docker', [
        'inspect',
        '--format',
        '{{.Image}}\n{{.Config.Image}}',
        container,
      ])
    ).stdout.split('\n');
    const imageId = identity[0]?.trim() ?? '';
    const configuredImage = identity[1]?.trim() ?? '';
    if (!IMAGE_ID.test(imageId)) {
      throw new Error('Running Supervisor image identity is invalid');
    }
    // A signed release container keeps its digest-pinned registry reference in
    // Config.Image. Prefer it over Docker's local config ID: the daemon may no
    // longer expose that ID after image-store cleanup even while the container
    // is still running. `docker run` can safely repull this exact digest. A
    // source installation has only a mutable local tag, so it stays pinned to
    // the exact running image ID instead.
    const helperImage = IMMUTABLE_IMAGE.test(configuredImage) ? configuredImage : imageId;
    const helper = `initpad-platform-updater-${randomUUID().slice(0, 8)}`;
    const operationId = basename(plan).match(/^update-([0-9a-f-]{36})\.json$/i)?.[1];
    if (!operationId || !UUID.test(operationId)) {
      throw new Error('Platform update plan name is invalid');
    }
    const environment = [
      `INITPAD_INSTALL_ROOT=${validInstallRoot()}`,
      `INITPAD_SUPERVISOR_STATE_DIR=${stateDirectory()}`,
      `INITPAD_SUPERVISOR_CONTAINER_NAME=${container}`,
      `INITPAD_UPDATE_REPOSITORY=${process.env.INITPAD_UPDATE_REPOSITORY || 'kudrle01/initpad'}`,
      'INITPAD_SIGSTORE_FORCE_CACHE=true',
    ];
    const args = [
      'run',
      '-d',
      '--rm',
      '--name',
      helper,
      '--label',
      `com.initpad.platform-update=${operationId}`,
      '--network',
      'none',
    ];
    for (const value of environment) args.push('-e', value);
    args.push('--volumes-from', container, helperImage, 'update-helper', '--plan', plan);
    try {
      await this.runner.run('docker', args);
    } catch (error) {
      await rm(plan, { force: true });
      throw error;
    }
  }

  async recoverInterruptedUpdate(): Promise<void> {
    const state = await loadState();
    const operation = state.operation;
    if (!operation || !['accepted', 'running'].includes(operation.status)) return;

    const helper = (
      await this.runner.run('docker', [
        'ps',
        '-q',
        '--filter',
        `label=com.initpad.platform-update=${operation.id}`,
      ])
    ).stdout;
    if (helper) {
      if (!/^[a-f0-9]{12,64}$/.test(helper)) {
        throw new Error('Platform update helper identity is invalid');
      }
      return;
    }

    const overridePath = runtimeOverride();
    const previousOverride = `${overridePath}.previous-${operation.id}`;
    const changed = ['switching', 'api', 'web', 'supervisor'].includes(operation.stage);
    try {
      if (changed) {
        const hadPrevious = await fileExists(previousOverride);
        if (hadPrevious) await copyFile(previousOverride, overridePath);
        else await rm(overridePath, { force: true });
        await this.runner.run('docker', [
          ...composeArgs(validInstallRoot(), hadPrevious),
          'up',
          '-d',
          '--no-deps',
          '--no-build',
          'api',
          'web',
        ]);
      }
      state.operation = {
        ...operation,
        status: changed ? 'rolled-back' : 'failed',
        stage: changed ? 'rolled-back' : 'interrupted',
        message: changed
          ? 'Interrupted platform update was rolled back during Supervisor recovery'
          : 'Platform update was interrupted before any image was switched',
        finishedAt: new Date().toISOString(),
      };
      await saveState(state);
      await rm(planPath(operation.id), { force: true });
      await rm(previousOverride, { force: true });
      await rm(updateLock(), { force: true });
    } catch (error) {
      state.operation = {
        ...operation,
        status: 'failed',
        stage: 'recovery-failed',
        message: `Automatic recovery failed: ${
          error instanceof Error ? error.message : 'unknown failure'
        }`.slice(0, 500),
        finishedAt: new Date().toISOString(),
      };
      await saveState(state);
    }
  }

  async applyPlan(path: string): Promise<void> {
    const lockPath = updateLock();
    await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
    await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') throw new Error('Another platform update is already running');
        throw error;
      },
    );
    let operation: UpdateOperation | null = null;
    let previousState: SupervisorState | null = null;
    let previousOverride = '';
    let hadOverride = false;
    let overridePrepared = false;
    let installRoot = '';
    try {
      const plan = await readPlan(path);
      const state = await loadState();
      operation = state.operation;
      previousState = structuredClone(state);
      if (!operation || operation.id !== plan.operationId) {
        throw new Error('Platform update operation state is missing');
      }
      const overridePath = runtimeOverride();
      await mkdir(dirname(overridePath), { recursive: true, mode: 0o700 });
      previousOverride = `${overridePath}.previous-${operation.id}`;
      hadOverride = await fileExists(overridePath);
      installRoot = validInstallRoot();
      await updateOperation(operation, {
        status: 'running',
        stage: 'verifying',
        message: 'Verifying the signed platform release',
      });
      const manifest = await this.verifyRelease(plan.release, operation.fromVersion);
      const override = renderOverride(manifest);
      if (sha256(override) !== manifest.compose.sha256) {
        throw new Error('Generated Compose override does not match the signed release');
      }
      if (hadOverride) await copyFile(overridePath, previousOverride);
      overridePrepared = true;

      const backupDirectory = resolve(stateDirectory(), 'backups');
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const backup = resolve(backupDirectory, `${operation.id}.dump`);
      await updateOperation(operation, {
        stage: 'backup',
        message: 'Creating and verifying the PostgreSQL backup',
        backupPath: backup,
      });
      const currentCompose = composeArgs(installRoot, hadOverride);
      await this.runner.outputToFile(
        'docker',
        [
          ...currentCompose,
          'exec',
          '-T',
          'postgres',
          'pg_dump',
          '-U',
          'initpad',
          '-d',
          'initpad',
          '-Fc',
        ],
        backup,
      );
      await this.runner.run(
        'docker',
        [...currentCompose, 'exec', '-T', 'postgres', 'pg_restore', '--list'],
        { inputFile: backup },
      );

      await updateOperation(operation, {
        stage: 'pulling',
        message: 'Pulling immutable platform images',
      });
      for (const component of ['api', 'web', 'supervisor'] as const) {
        await this.runner.run('docker', ['pull', manifest.images[component].immutableReference]);
      }
      await updateOperation(operation, {
        stage: 'switching',
        message: 'Switching to the verified platform release',
      });
      await atomicWrite(overridePath, override);
      const candidateCompose = composeArgs(installRoot, true);

      await updateOperation(operation, {
        stage: 'api',
        message: 'Applying compatible migrations and checking the API',
      });
      await this.runner.run('docker', [
        ...candidateCompose,
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        'api',
      ]);
      await this.waitForService(candidateCompose, 'api');

      await updateOperation(operation, {
        stage: 'web',
        message: 'Switching the web application and checking readiness',
      });
      await this.runner.run('docker', [
        ...candidateCompose,
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        'web',
      ]);
      await this.waitForService(candidateCompose, 'web');

      await updateOperation(operation, {
        stage: 'supervisor',
        message: 'Switching the release Supervisor and checking readiness',
      });
      await this.runner.run('docker', [
        ...candidateCompose,
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        'supervisor',
      ]);
      await this.waitForService(candidateCompose, 'supervisor');
      const completed: SupervisorState = {
        schemaVersion: 1,
        currentVersion: manifest.version,
        currentImages: {
          api: manifest.images.api.immutableReference,
          web: manifest.images.web.immutableReference,
          supervisor: manifest.images.supervisor.immutableReference,
        },
        operation: {
          ...operation,
          status: 'succeeded',
          stage: 'completed',
          message: `InitPad ${manifest.version} installed successfully`,
          finishedAt: new Date().toISOString(),
        },
      };
      await saveState(completed);
      await rm(previousOverride, { force: true });
    } catch (error) {
      const overridePath = runtimeOverride();
      if (overridePrepared) {
        if (hadOverride && previousOverride) {
          await copyFile(previousOverride, overridePath).catch(() => undefined);
        } else {
          await rm(overridePath, { force: true });
        }
      }
      const message = error instanceof Error ? error.message : 'Platform update failed';
      if (previousState && operation) {
        previousState.operation = {
          ...operation,
          status: 'rolled-back',
          stage: 'rolled-back',
          message: `Update rolled back: ${message}`.slice(0, 500),
          finishedAt: new Date().toISOString(),
        };
        await saveState(previousState).catch(() => undefined);
      }
      if (installRoot) {
        const rollbackCompose = composeArgs(installRoot, hadOverride);
        await this.runner
          .run('docker', [
            ...rollbackCompose,
            'up',
            '-d',
            '--no-deps',
            '--no-build',
            'api',
            'web',
            'supervisor',
          ])
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(path, { force: true });
      if (previousOverride) await rm(previousOverride, { force: true });
      await rm(lockPath, { force: true });
    }
  }

  private async waitForService(compose: string[], service: string): Promise<void> {
    const id = (await this.runner.run('docker', [...compose, 'ps', '-q', service])).stdout;
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`${service} container was not created`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = (
        await this.runner.run('docker', [
          'inspect',
          '--format',
          '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
          id,
        ])
      ).stdout;
      if (status === 'healthy') return;
      if (status === 'exited' || status === 'dead' || status === 'unhealthy') {
        throw new Error(`${service} became ${status}`);
      }
      await this.wait(3_000);
    }
    throw new Error(`${service} readiness timed out`);
  }
}
