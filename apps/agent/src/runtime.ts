import {
  claimJob,
  completeJob,
  heartbeat,
  renewJobLease,
  reportJobProgress,
  ControlPlaneError,
} from './control-plane.js';
import { inspectDocker } from './docker.js';
import { executeClaimedJob } from './job-worker.js';
import type { AgentConfig, DockerCapabilities, HeartbeatResponse } from './types.js';

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  target(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
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

export async function heartbeatOnce(
  config: AgentConfig,
  dockerHost = process.env.DOCKER_HOST,
): Promise<{ docker: DockerCapabilities; response: HeartbeatResponse }> {
  const docker = await inspectDocker(dockerHost);
  const response = await heartbeat(config, docker);
  if (response.targetId !== config.targetId) {
    throw new Error('Control plane returned a different target identity');
  }
  if (response.credentialGeneration !== config.credentialGeneration) {
    throw new Error('Control plane returned a different credential generation');
  }
  return { docker, response };
}

export async function runAgent(
  config: AgentConfig,
  signal: AbortSignal,
  dockerHost = process.env.DOCKER_HOST,
): Promise<void> {
  const runtimeController = new AbortController();
  const abortRuntime = () => runtimeController.abort();
  signal.addEventListener('abort', abortRuntime, { once: true });
  if (signal.aborted) runtimeController.abort();
  const runtimeSignal = runtimeController.signal;
  log('info', 'agent.started', {
    targetId: config.targetId,
    credentialGeneration: config.credentialGeneration,
  });
  try {
    await Promise.all([
      runHeartbeatLoop(config, runtimeSignal, dockerHost),
      runJobLoop(config, runtimeSignal),
    ]);
  } finally {
    runtimeController.abort();
    signal.removeEventListener('abort', abortRuntime);
    log('info', 'agent.stopped', { targetId: config.targetId });
  }
}

async function runHeartbeatLoop(
  config: AgentConfig,
  signal: AbortSignal,
  dockerHost = process.env.DOCKER_HOST,
): Promise<void> {
  let retrySeconds = 2;
  while (!signal.aborted) {
    try {
      const { docker, response } = await heartbeatOnce(config, dockerHost);
      retrySeconds = 2;
      log('info', 'heartbeat.accepted', {
        targetId: config.targetId,
        dockerVersion: docker.engineVersion,
        nextHeartbeatSeconds: response.nextHeartbeatSeconds,
      });
      const interval = Math.min(300, Math.max(10, response.nextHeartbeatSeconds));
      await delay(interval * 1000, signal);
    } catch (error) {
      if (error instanceof ControlPlaneError && error.status >= 400 && error.status < 500) {
        log('error', 'agent.credential_rejected', {
          targetId: config.targetId,
          status: error.status,
          message: error.message,
        });
        throw error;
      }
      log('warn', 'heartbeat.retrying', {
        targetId: config.targetId,
        retrySeconds,
        message: error instanceof Error ? error.message : 'Unknown heartbeat error',
      });
      await delay(retrySeconds * 1000, signal);
      retrySeconds = Math.min(60, retrySeconds * 2);
    }
  }
}

async function runJobLoop(config: AgentConfig, signal: AbortSignal): Promise<void> {
  let retrySeconds = 2;
  while (!signal.aborted) {
    try {
      const response = await claimJob(config);
      retrySeconds = 2;
      if (!response.job) {
        const interval = Math.min(30, Math.max(1, response.nextPollSeconds));
        await delay(interval * 1000, signal);
        continue;
      }
      if (response.job.targetId !== config.targetId) {
        throw new Error('Control plane returned a job for a different target');
      }
      log('info', 'job.claimed', {
        targetId: config.targetId,
        jobId: response.job.id,
        kind: response.job.kind,
        attempt: response.job.attempt,
      });
      try {
        await executeClaimedJob(response.job, signal, {
          renew: (jobId, leaseToken) => renewJobLease(config, jobId, leaseToken),
          progress: (jobId, input) => reportJobProgress(config, jobId, input),
          complete: (jobId, input) => completeJob(config, jobId, input),
        }, { dockerHost: process.env.DOCKER_HOST });
        if (!signal.aborted) {
          log('info', 'job.completed', {
            targetId: config.targetId,
            jobId: response.job.id,
            kind: response.job.kind,
            attempt: response.job.attempt,
          });
        }
      } catch (error) {
        if (error instanceof ControlPlaneError && error.status === 409) {
          log('warn', 'job.lease_lost', {
            targetId: config.targetId,
            jobId: response.job.id,
            attempt: response.job.attempt,
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof ControlPlaneError && error.status >= 400 && error.status < 500) {
        log('error', 'agent.credential_or_protocol_rejected', {
          targetId: config.targetId,
          status: error.status,
          message: error.message,
        });
        throw error;
      }
      log('warn', 'job.poll_retrying', {
        targetId: config.targetId,
        retrySeconds,
        message: error instanceof Error ? error.message : 'Unknown Agent job error',
      });
      await delay(retrySeconds * 1000, signal);
      retrySeconds = Math.min(60, retrySeconds * 2);
    }
  }
}
