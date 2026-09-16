import { loadConfig, DEFAULT_CONFIG_PATH } from './config.js';
import { completeJob, renewJobLease, reportJobProgress } from './control-plane.js';
import { AgentUpdateDocker } from './agent-update-docker.js';
import { DockerLifecycle } from './docker-lifecycle.js';
import {
  readUpdatePlan,
  removeUpdatePlan,
  verifyAgentUpdatePayload,
  writeUpdatePlan,
} from './release-update.js';
import type { AgentUpdatePlan } from './release-update.js';
import type { AgentJobClaim } from './types.js';

export interface AgentUpdateProgress {
  percent: number;
  stage: 'working' | 'verifying';
  message: string;
}

export interface AgentUpdateHandoffRunner {
  handoff(
    job: AgentJobClaim,
    signal: AbortSignal,
    report: (progress: AgentUpdateProgress) => Promise<void>,
  ): Promise<void>;
}

export class AgentUpdateCoordinator implements AgentUpdateHandoffRunner {
  constructor(
    private readonly docker = new AgentUpdateDocker(),
    private readonly lifecycle = new DockerLifecycle('agent-self-update'),
  ) {}

  async handoff(
    job: AgentJobClaim,
    signal: AbortSignal,
    report: (progress: AgentUpdateProgress) => Promise<void>,
  ): Promise<void> {
    await report({
      percent: 8,
      stage: 'verifying',
      message: 'Verifying signed Agent release manifest',
    });
    const release = await verifyAgentUpdatePayload(job.payload);
    await report({
      percent: 22,
      stage: 'working',
      message: `Pulling immutable Agent ${release.version} image`,
    });
    await this.lifecycle.pullImage(release.image, signal);
    const plan: AgentUpdatePlan = {
      schemaVersion: 1,
      jobId: job.id,
      attempt: job.attempt,
      leaseToken: job.leaseToken,
      targetId: job.targetId,
      version: release.version,
      image: release.image,
      createdAt: new Date().toISOString(),
    };
    const planPath = await writeUpdatePlan(plan);
    try {
      await report({
        percent: 42,
        stage: 'working',
        message: 'Handing update to the local rollback supervisor',
      });
      await this.docker.launchHelper(plan, planPath, signal);
    } catch (error) {
      await removeUpdatePlan(planPath);
      throw error;
    }
  }
}

export async function runAgentUpdateHelper(
  planPath: string,
  signal: AbortSignal,
  docker = new AgentUpdateDocker(),
  configPath = process.env.INITPAD_AGENT_CONFIG || DEFAULT_CONFIG_PATH,
): Promise<void> {
  const plan = await readUpdatePlan(planPath);
  let config = await loadConfig(configPath);
  if (config.targetId !== plan.targetId)
    throw new Error('Agent update plan targets another server');
  let sequence = 3;
  const renew = async () => {
    await renewJobLease(config, plan.jobId, plan.leaseToken);
  };
  const progress = async (percent: number, stage: 'working' | 'verifying', message: string) => {
    sequence += 1;
    await reportJobProgress(config, plan.jobId, {
      leaseToken: plan.leaseToken,
      sequence,
      percent,
      stage,
      message,
    });
  };

  try {
    await renew();
    await progress(55, 'verifying', 'Preflighting the candidate with the existing identity');
    await docker.apply(plan, signal, renew);
    config = await loadConfig(configPath);
    await progress(95, 'verifying', 'Updated Agent heartbeat confirmed; removing rollback slot');
    await completeJob(config, plan.jobId, {
      leaseToken: plan.leaseToken,
      status: 'succeeded',
      message: `Agent ${plan.version} installed and heartbeat verified`,
      resultCode: 'agent_updated',
    });
  } catch (error) {
    config = await loadConfig(configPath).catch(() => config);
    const message = error instanceof Error ? error.message : 'Agent update failed';
    await completeJob(config, plan.jobId, {
      leaseToken: plan.leaseToken,
      status: 'failed',
      message: `Agent update rolled back: ${message}`.slice(0, 240),
      resultCode: 'agent_update_rolled_back',
    }).catch(() => undefined);
    throw error;
  } finally {
    await removeUpdatePlan(planPath);
  }
}
