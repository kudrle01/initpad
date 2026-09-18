import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SupervisorState } from './types.js';
import { SUPERVISOR_VERSION } from './types.js';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function stateDirectory(): string {
  return resolve(process.env.INITPAD_SUPERVISOR_STATE_DIR || '/var/lib/initpad-supervisor');
}

function initialState(): SupervisorState {
  return {
    schemaVersion: 1,
    currentVersion: process.env.INITPAD_PLATFORM_VERSION || SUPERVISOR_VERSION,
    currentImages: null,
    operation: null,
  };
}

export async function loadState(): Promise<SupervisorState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as SupervisorState;
    if (parsed.schemaVersion !== 1 || !VERSION.test(parsed.currentVersion)) {
      throw new Error('Supervisor state has an unsupported schema');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const state = initialState();
    await saveState(state);
    return state;
  }
}

export async function adoptCurrentRelease(version: string): Promise<void> {
  if (
    !VERSION.test(version) ||
    version !== SUPERVISOR_VERSION ||
    version !== process.env.INITPAD_PLATFORM_VERSION
  ) {
    throw new Error('Recovery release version does not match the running Supervisor image');
  }
  const state = await loadState();
  state.currentVersion = version;
  state.currentImages = null;
  state.operation = null;
  await saveState(state);
}

export async function saveState(state: SupervisorState): Promise<void> {
  const directory = stateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = resolve(directory, `.state-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600);
  await rename(temporary, statePath());
}

export function statePath(): string {
  return resolve(stateDirectory(), 'state.json');
}
