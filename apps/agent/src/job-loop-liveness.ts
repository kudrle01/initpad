import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The heartbeat proves only that the process can reach the control plane. The
 * job loop can stall independently (a hung job, a handoff that never returned),
 * so `initpad-agent health` checks this marker written by the loop itself.
 */
export type JobLoopPhase = 'polling' | 'job' | 'handoff';

/** How long each phase may go without a fresh marker before health fails. */
const PHASE_BUDGET_MS: Record<JobLoopPhase, number> = {
  polling: 3 * 60_000,
  // An image archive load alone may take 10 minutes (docker-lifecycle).
  job: 30 * 60_000,
  handoff: 20 * 60_000,
};

export function livenessPath(): string {
  return (
    process.env.INITPAD_AGENT_LIVENESS_FILE?.trim() || join(tmpdir(), 'initpad-agent-loop.json')
  );
}

export async function recordJobLoop(
  phase: JobLoopPhase,
  path = livenessPath(),
  now = Date.now(),
): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ phase, at: now }), { mode: 0o600 });
    await rename(temporary, path);
  } catch {
    // Liveness is diagnostic only; a read-only or full disk must not stop jobs.
  }
}

export async function checkJobLoop(
  path = livenessPath(),
  now = Date.now(),
): Promise<{ ok: boolean; message: string }> {
  let marker: { phase?: unknown; at?: unknown };
  try {
    marker = JSON.parse(await readFile(path, 'utf8')) as typeof marker;
  } catch {
    return { ok: false, message: 'job loop has not started (no liveness marker)' };
  }
  const phase = marker.phase as JobLoopPhase;
  const at = Number(marker.at);
  if (!(phase in PHASE_BUDGET_MS) || !Number.isFinite(at)) {
    return { ok: false, message: 'job loop liveness marker is invalid' };
  }
  const ageSeconds = Math.max(0, Math.round((now - at) / 1_000));
  if (now - at > PHASE_BUDGET_MS[phase]) {
    return { ok: false, message: `job loop stalled in ${phase} for ${ageSeconds} s` };
  }
  return { ok: true, message: `job loop ${phase} ${ageSeconds} s ago` };
}

/**
 * After handing an update to the helper, the old Agent keeps running until the
 * helper replaces it. If the helper finishes without doing so (preflight or
 * checkpoint failed), it removes the plan file and this Agent must resume work
 * instead of idling forever behind a healthy-looking heartbeat.
 */
export async function waitForUpdateHandoff(
  planPath: string,
  signal: AbortSignal,
  options: {
    pollMs?: number;
    maxMs?: number;
    exists?: (path: string) => Promise<boolean>;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<'plan-removed' | 'timed-out' | 'aborted'> {
  const pollMs = options.pollMs ?? 5_000;
  const maxMs = options.maxMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  const exists =
    options.exists ??
    ((path: string) =>
      access(path).then(
        () => true,
        () => false,
      ));
  const sleep =
    options.sleep ??
    ((ms: number, abort: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        abort.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }));
  const deadline = now() + maxMs;
  while (!signal.aborted) {
    if (!(await exists(planPath))) return 'plan-removed';
    if (now() >= deadline) return 'timed-out';
    await recordJobLoop('handoff');
    await sleep(pollMs, signal);
  }
  return 'aborted';
}
