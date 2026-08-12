import { ControlPlaneError } from './control-plane.js';
import { DockerLifecycle, parseLifecyclePayload } from './docker-lifecycle.js';
import type { DockerLifecycleProgress } from './docker-lifecycle.js';
import type { AgentJobClaim, AgentJobResult, AgentJobSummary } from './types.js';

const RENEW_EVERY_MS = 10_000;
const PROGRESS_EVERY_MS = 5_000;

export interface AgentJobClient {
  renew(jobId: string, leaseToken: string): Promise<{ leaseExpiresAt: string }>;
  progress(jobId: string, input: {
    leaseToken: string;
    sequence: number;
    percent: number;
    stage: 'accepted' | 'working' | 'verifying';
    message: string;
  }): Promise<AgentJobSummary>;
  complete(jobId: string, input: {
    leaseToken: string;
    status: 'succeeded' | 'failed';
    message: string;
    resultCode?: string;
    result?: AgentJobResult;
  }): Promise<AgentJobSummary>;
}

interface ProbePayload {
  durationSeconds: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export interface JobTiming {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  renewEveryMs: number;
  progressEveryMs: number;
}

const REAL_TIMING: JobTiming = {
  now: () => Date.now(),
  sleep: delay,
  renewEveryMs: RENEW_EVERY_MS,
  progressEveryMs: PROGRESS_EVERY_MS,
};

export interface LifecycleRunner {
  acceptance(
    payload: unknown,
    jobId: string,
    signal: AbortSignal,
    report: (progress: DockerLifecycleProgress) => Promise<void>,
  ): Promise<void>;
}

export interface JobExecutionOptions {
  timing?: JobTiming;
  lifecycle?: LifecycleRunner;
  dockerHost?: string;
}

function probePayload(value: unknown): ProbePayload {
  if (!value || typeof value !== 'object') throw new Error('Probe payload is invalid');
  const durationSeconds = (value as Record<string, unknown>).durationSeconds;
  if (!Number.isInteger(durationSeconds) || Number(durationSeconds) < 5 || Number(durationSeconds) > 60) {
    throw new Error('Probe duration is outside the supported range');
  }
  return { durationSeconds: Number(durationSeconds) };
}

async function retryProtocolCall<T>(
  action: () => Promise<T>,
  leaseDeadline: () => number,
  signal: AbortSignal,
  timing: JobTiming,
): Promise<T> {
  let retryMs = 500;
  while (!signal.aborted) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ControlPlaneError && error.status >= 400 && error.status < 500) {
        throw error;
      }
      if (timing.now() + retryMs >= leaseDeadline()) throw error;
      await timing.sleep(retryMs, signal);
      retryMs = Math.min(2_000, retryMs * 2);
    }
  }
  throw new Error('Agent job interrupted');
}

export async function executeClaimedJob(
  job: AgentJobClaim,
  signal: AbortSignal,
  client: AgentJobClient,
  options: JobExecutionOptions = {},
): Promise<void> {
  const timing = options.timing ?? REAL_TIMING;
  let leaseDeadline = Date.parse(job.leaseExpiresAt);
  if (!Number.isFinite(leaseDeadline)) throw new Error('Agent job lease expiry is invalid');

  const complete = (input: Parameters<AgentJobClient['complete']>[1]) =>
    retryProtocolCall(
      () => client.complete(job.id, input),
      () => leaseDeadline,
      signal,
      timing,
    );

  if (job.protocolVersion !== 1 || !['probe', 'lifecycle-test'].includes(job.kind)) {
    await complete({
      leaseToken: job.leaseToken,
      status: 'failed',
      message: `Agent ${job.protocolVersion === 1 ? 'does not support this job kind' : 'does not support this protocol version'}`,
      resultCode: 'unsupported_job',
    });
    return;
  }

  if (job.kind === 'lifecycle-test') {
    try {
      parseLifecyclePayload(job.payload);
    } catch (error) {
      await complete({
        leaseToken: job.leaseToken,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Lifecycle payload is invalid',
        resultCode: 'invalid_payload',
      });
      return;
    }

    const lifecycle = options.lifecycle
      ?? new DockerLifecycle(job.targetId, options.dockerHost);
    const localController = new AbortController();
    const combinedSignal = AbortSignal.any([signal, localController.signal]);
    let renewalError: unknown;
    const renewal = (async () => {
      while (!combinedSignal.aborted) {
        await timing.sleep(timing.renewEveryMs, combinedSignal);
        if (combinedSignal.aborted) return;
        try {
          const renewed = await retryProtocolCall(
            () => client.renew(job.id, job.leaseToken),
            () => leaseDeadline,
            combinedSignal,
            timing,
          );
          const renewedDeadline = Date.parse(renewed.leaseExpiresAt);
          if (!Number.isFinite(renewedDeadline)) {
            throw new Error('Renewed Agent job lease is invalid');
          }
          leaseDeadline = renewedDeadline;
        } catch (error) {
          renewalError = error;
          localController.abort();
          return;
        }
      }
    })();

    let sequence = 0;
    let lifecycleError: unknown;
    try {
      await lifecycle.acceptance(job.payload, job.id, combinedSignal, async (progress) => {
        sequence += 1;
        try {
          await retryProtocolCall(
            () => client.progress(job.id, {
              leaseToken: job.leaseToken,
              sequence,
              percent: progress.percent,
              stage: progress.stage,
              message: progress.message,
            }),
            () => leaseDeadline,
            combinedSignal,
            timing,
          );
        } catch (error) {
          localController.abort();
          throw error;
        }
      });
    } catch (error) {
      lifecycleError = error;
    } finally {
      localController.abort();
      await renewal;
    }
    if (signal.aborted) return;
    if (renewalError) throw renewalError;
    if (lifecycleError instanceof ControlPlaneError) throw lifecycleError;
    if (lifecycleError) {
      await complete({
        leaseToken: job.leaseToken,
        status: 'failed',
        message: (lifecycleError instanceof Error
          ? lifecycleError.message
          : 'Docker lifecycle test failed').slice(0, 240),
        resultCode: 'lifecycle_failed',
      });
      return;
    }
    await complete({
      leaseToken: job.leaseToken,
      status: 'succeeded',
      message: 'Docker lifecycle test completed and cleaned up',
      resultCode: 'ok',
    });
    return;
  }

  let payload: ProbePayload;
  try {
    payload = probePayload(job.payload);
  } catch (error) {
    await complete({
      leaseToken: job.leaseToken,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Probe payload is invalid',
      resultCode: 'invalid_payload',
    });
    return;
  }

  let sequence = 1;
  await retryProtocolCall(
    () => client.progress(job.id, {
      leaseToken: job.leaseToken,
      sequence,
      percent: 5,
      stage: 'accepted',
      message: 'Agent accepted the protocol probe',
    }),
    () => leaseDeadline,
    signal,
    timing,
  );

  const startedAt = timing.now();
  const durationMs = payload.durationSeconds * 1000;
  let nextRenewAt = startedAt + timing.renewEveryMs;
  let nextProgressAt = startedAt + timing.progressEveryMs;
  while (!signal.aborted && timing.now() - startedAt < durationMs) {
    const remaining = durationMs - (timing.now() - startedAt);
    const wakeAt = Math.min(nextRenewAt, nextProgressAt, timing.now() + remaining);
    await timing.sleep(Math.max(1, wakeAt - timing.now()), signal);
    if (signal.aborted) return;

    if (timing.now() >= nextRenewAt) {
      const renewed = await retryProtocolCall(
        () => client.renew(job.id, job.leaseToken),
        () => leaseDeadline,
        signal,
        timing,
      );
      const renewedDeadline = Date.parse(renewed.leaseExpiresAt);
      if (!Number.isFinite(renewedDeadline)) throw new Error('Renewed Agent job lease is invalid');
      leaseDeadline = renewedDeadline;
      nextRenewAt = timing.now() + timing.renewEveryMs;
    }

    if (timing.now() >= nextProgressAt && timing.now() - startedAt < durationMs) {
      sequence += 1;
      const percent = Math.min(90, 5 + Math.floor(((timing.now() - startedAt) / durationMs) * 85));
      await retryProtocolCall(
        () => client.progress(job.id, {
          leaseToken: job.leaseToken,
          sequence,
          percent,
          stage: 'working',
          message: 'Lease renewal and progress channel are healthy',
        }),
        () => leaseDeadline,
        signal,
        timing,
      );
      nextProgressAt = timing.now() + timing.progressEveryMs;
    }
  }
  if (signal.aborted) return;

  sequence += 1;
  await retryProtocolCall(
    () => client.progress(job.id, {
      leaseToken: job.leaseToken,
      sequence,
      percent: 99,
      stage: 'verifying',
      message: 'Verifying idempotent completion',
    }),
    () => leaseDeadline,
    signal,
    timing,
  );
  await complete({
    leaseToken: job.leaseToken,
    status: 'succeeded',
    message: 'Agent job protocol probe completed',
    resultCode: 'ok',
  });
}
