import {
  Environment,
  PipelineStage,
  StageStatus,
  TemplateManifest,
} from '../domain/types';
import { CI_WAITING_REASON } from './ci-state';

export interface ScmPipelineStatus {
  context: string;
  status: string;
  targetUrl: string | null;
}

export interface PipelineDeploymentOperation {
  status: string;
  buildArtifact?: { providerRunId: string } | null;
}

function jobFromContext(context: string): string | null {
  if (!context) return null;
  const noEvent = context.replace(/\s*\([^)]*\)\s*$/, '');
  const job = noEvent.includes('/')
    ? noEvent.slice(noEvent.lastIndexOf('/') + 1)
    : noEvent;
  return job.trim().toLowerCase();
}

function ciStatus(state: string): StageStatus {
  if (state === 'success') return 'success';
  if (state === 'failure' || state === 'error') return 'failed';
  // Gitea 1.22 uses pending for both queued and executing jobs. The initial
  // distinction is resolved by the authenticated runner-start callback below.
  return 'running';
}

// Provider-neutral SCM statuses become the stable pipeline shown by the API.
export function pipelineStages(
  template: TemplateManifest,
  statuses: ScmPipelineStatus[] | null,
): PipelineStage[] {
  const definitions: { label: string; tokens: string[] }[] =
    template.artifact === 'static'
      ? [
          { label: 'build', tokens: ['build'] },
          { label: 'test', tokens: ['test'] },
          { label: 'deploy', tokens: ['deploy'] },
        ]
      : [
          { label: 'build', tokens: ['build'] },
          { label: 'test', tokens: ['test'] },
          { label: 'docker build', tokens: ['docker', 'docker build'] },
          { label: 'deploy', tokens: ['deploy'] },
        ];

  // Providers return newest statuses first; keep only the latest result and
  // log link for each normalized workflow job.
  const latest = new Map<string, { status: string; url: string | null }>();
  for (const status of statuses ?? []) {
    const job = jobFromContext(status.context);
    if (job && !latest.has(job)) {
      latest.set(job, { status: status.status, url: status.targetUrl });
    }
  }

  const stages = definitions.map((definition) => {
    const hit = definition.tokens.map((token) => latest.get(token)).find(Boolean);
    return {
      name: definition.label,
      status: hit ? ciStatus(hit.status) : ('pending' as StageStatus),
      url: hit?.url ?? null,
    };
  });

  // Jobs use `needs`, so stages behind the first unfinished one are queued.
  let blocked = false;
  for (const stage of stages) {
    if (blocked && stage.status === 'running') stage.status = 'pending';
    if (stage.status !== 'success') blocked = true;
  }
  return stages;
}

// SCM jobs and target publication are separate audit records. Add the latter
// without rewriting the provider's job result or log URL.
export function withDeploymentState(
  stages: PipelineStage[],
  environment: Environment | null | undefined,
  operation?: PipelineDeploymentOperation | null,
): PipelineStage[] {
  const visibleStages =
    environment?.status === 'deploying' &&
    environment.statusReason === CI_WAITING_REASON
      ? stages.map((stage) =>
          stage.status === 'running'
            ? { ...stage, status: 'pending' as StageStatus }
            : stage,
        )
      : stages;
  const deployIndex = visibleStages.findIndex((stage) => stage.name === 'deploy');
  if (deployIndex < 0) return visibleStages;

  let status: StageStatus | null = null;
  if (environment) {
    if (environment.status === 'deploying') status = 'running';
    else if (environment.deploymentRequired) {
      status = environment.status === 'failed' ? 'failed' : 'pending';
    } else if (environment.status === 'running' || environment.status === 'stopped') {
      status = 'success';
    } else if (environment.status === 'failed') {
      status = 'failed';
    }
  } else if (operation?.buildArtifact) {
    if (operation.status === 'running') status = 'running';
    else if (operation.status === 'succeeded') status = 'success';
    else if (operation.status === 'failed') status = 'failed';
    else if (operation.status === 'cancelled') status = 'pending';
  }
  if (!status) return visibleStages;

  if (
    status === 'running' &&
    !visibleStages.slice(0, deployIndex).every((stage) => stage.status === 'success')
  ) {
    status = 'pending';
  }
  return [
    ...visibleStages,
    { name: 'publish', status, url: null, source: 'platform' },
  ];
}
