import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { adoptCurrentRelease, loadState, saveState, statePath } from './state.js';
import { SUPERVISOR_VERSION } from './types.js';

test('state is not advanced merely because a newer Supervisor process started', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'initpad-supervisor-state-'));
  process.env.INITPAD_SUPERVISOR_STATE_DIR = directory;
  try {
    await saveState({
      schemaVersion: 1,
      currentVersion: '0.1.0',
      currentImages: null,
      operation: null,
    });
    assert.equal((await loadState()).currentVersion, '0.1.0');
    assert.equal(
      (JSON.parse(await readFile(statePath(), 'utf8')) as { currentVersion: string })
        .currentVersion,
      '0.1.0',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the verified recovery installer can explicitly adopt its exact release', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'initpad-supervisor-state-'));
  process.env.INITPAD_SUPERVISOR_STATE_DIR = directory;
  process.env.INITPAD_PLATFORM_VERSION = SUPERVISOR_VERSION;
  try {
    await saveState({
      schemaVersion: 1,
      currentVersion: '0.1.0',
      currentImages: null,
      operation: null,
    });
    await adoptCurrentRelease(SUPERVISOR_VERSION);
    assert.equal((await loadState()).currentVersion, SUPERVISOR_VERSION);
    await assert.rejects(adoptCurrentRelease('0.3.0'), /does not match/);
  } finally {
    delete process.env.INITPAD_PLATFORM_VERSION;
    await rm(directory, { recursive: true, force: true });
  }
});
