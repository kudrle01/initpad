import { heartbeat, ControlPlaneError } from './control-plane.js';
import { inspectDocker } from './docker.js';
import type { AgentConfig, DockerCapabilities, HeartbeatResponse } from './types.js';

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  target(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details }));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
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
  let retrySeconds = 2;
  log('info', 'agent.started', {
    targetId: config.targetId,
    credentialGeneration: config.credentialGeneration,
  });
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
  log('info', 'agent.stopped', { targetId: config.targetId });
}
