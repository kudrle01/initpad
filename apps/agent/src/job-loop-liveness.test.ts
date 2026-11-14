import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkJobLoop, recordJobLoop, waitForUpdateHandoff } from './job-loop-liveness.js';

test('health fails when the job loop marker is missing or stale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'initpad-liveness-'));
  const path = join(dir, 'loop.json');
  try {
    assert.equal((await checkJobLoop(path)).ok, false);
    const start = Date.parse('2026-11-14T10:00:00.000Z');
    await recordJobLoop('polling', path, start);
    assert.equal((await checkJobLoop(path, start + 60_000)).ok, true);
    const stalled = await checkJobLoop(path, start + 10 * 60_000);
    assert.equal(stalled.ok, false);
    assert.match(stalled.message, /stalled in polling for 600 s/);
    // A long deploy has a larger budget than an idle poll.
    await recordJobLoop('job', path, start);
    assert.equal((await checkJobLoop(path, start + 10 * 60_000)).ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the old Agent resumes once the update helper removes its plan', async () => {
  let checks = 0;
  const outcome = await waitForUpdateHandoff(
    '/var/lib/initpad-agent/update-x-1.json',
    new AbortController().signal,
    {
      exists: async () => {
        checks += 1;
        return checks < 3;
      },
      sleep: async () => undefined,
    },
  );
  assert.equal(outcome, 'plan-removed');
  assert.equal(checks, 3);
});

test('the old Agent resumes after the handoff budget even if the helper vanished', async () => {
  let now = 0;
  const outcome = await waitForUpdateHandoff(
    '/var/lib/initpad-agent/update-x-1.json',
    new AbortController().signal,
    {
      exists: async () => true,
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      pollMs: 5_000,
      maxMs: 60_000,
    },
  );
  assert.equal(outcome, 'timed-out');
  assert.ok(now >= 60_000);
});

test('shutdown during the handoff wait stops without resuming', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await waitForUpdateHandoff('/x', controller.signal, { exists: async () => true }),
    'aborted',
  );
});
