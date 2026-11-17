import {
  Environment,
  PipelineStage,
  PipelineStep,
  StageStatus,
  TemplateManifest,
} from '../domain/types';
import { CI_WAITING_REASON } from './ci-state';

export interface ScmPipelineStatus {
  context: string;
  status: string;
  targetUrl: string | null;
  steps?: PipelineStep[];
}

export interface PipelineDeploymentOperation {
  status: string;
  buildArtifact?: { providerRunId: string } | null;
}

// "ci / build (push)" (Gitea commit status) or "build" (GitHub Actions job).
// A status of another workflow is not part of the InitPad pipeline.
function jobFromContext(context: string): { key: string; label: string } | null {
  if (!context) return null;
  const noEvent = context.replace(/\s*\([^)]*\)\s*$/, '');
  const slash = noEvent.lastIndexOf('/');
  if (slash >= 0 && noEvent.slice(0, slash).trim().toLowerCase() !== 'ci') return null;
  const label = (slash >= 0 ? noEvent.slice(slash + 1) : noEvent).trim();
  return label ? { key: label.toLowerCase(), label } : null;
}

function ciStatus(state: string): StageStatus {
  if (state === 'success') return 'success';
  if (state === 'failure' || state === 'error') return 'failed';
  // Gitea 1.22 uses pending for both queued and executing jobs. The initial
  // distinction is resolved by the authenticated runner-start callback below.
  return 'running';
}

// Workflows generated before ADR-139 split CI into four jobs. Their projects
// keep the matching stages; current workflows have a single build job.
const LEGACY_JOBS = new Set(['test', 'docker', 'docker build', 'deploy']);

function stageDefinitions(
  template: TemplateManifest,
  jobs: Map<string, { label: string }>,
): { label: string; tokens: string[] }[] {
  if (![...jobs.keys()].some((job) => LEGACY_JOBS.has(job))) {
    // Every job of the workflow is a stage, in the order the provider lists
    // them; the generated workflow has a single build job.
    if (jobs.size === 0) return [{ label: 'build', tokens: ['build'] }];
    return [...jobs].map(([key, job]) => ({ label: job.label, tokens: [key] }));
  }
  return template.artifact === 'static'
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
}

// Provider-neutral SCM statuses become the stable pipeline shown by the API.
export function pipelineStages(
  template: TemplateManifest,
  statuses: ScmPipelineStatus[] | null,
): PipelineStage[] {
  // Providers return newest statuses first; keep only the latest result and
  // log link for each normalized workflow job.
  const latest = new Map<
    string,
    { label: string; status: string; url: string | null; steps?: PipelineStep[] }
  >();
  for (const status of statuses ?? []) {
    const job = jobFromContext(status.context);
    if (job && !latest.has(job.key)) {
      latest.set(job.key, {
        label: job.label,
        status: status.status,
        url: status.targetUrl,
        steps: status.steps,
      });
    }
  }
  const definitions = stageDefinitions(template, latest);
  const legacy = [...latest.keys()].some((job) => LEGACY_JOBS.has(job));

  const stages = definitions.map<PipelineStage>((definition) => {
    const hit = definition.tokens.map((token) => latest.get(token)).find(Boolean);
    return {
      name: definition.label,
      status: hit ? ciStatus(hit.status) : 'pending',
      url: hit?.url ?? null,
      ...(hit?.steps?.length ? { steps: hit.steps } : {}),
    };
  });

  // The older four jobs ran in a `needs` chain, so stages behind the first
  // unfinished one are queued. Jobs of other workflows may run in parallel.
  if (legacy) {
    let blocked = false;
    for (const stage of stages) {
      if (blocked && stage.status === 'running') stage.status = 'pending';
      if (stage.status !== 'success') blocked = true;
    }
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
    environment?.status === 'deploying' && environment.statusReason === CI_WAITING_REASON
      ? stages.map<PipelineStage>((stage) =>
          stage.status === 'running' ? { ...stage, status: 'pending' } : stage,
        )
      : stages;
  // A legacy workflow reports its own deploy job; publication follows the
  // jobs before it. A current workflow reports from inside its build job.
  const deployIndex = visibleStages.findIndex((stage) => stage.name === 'deploy');
  const ciStages = deployIndex < 0 ? visibleStages : visibleStages.slice(0, deployIndex);

  let status: StageStatus | null = null;
  if (environment) {
    if (environment.status === 'deploying') status = 'running';
    // A managed-gateway rollback can keep the previous revision online while
    // the attempted publication itself fails. `deploymentRequired` remains
    // true so the user can retry, but that must not be projected as an
    // indeterminate pending/CI state: the latest platform audit record is
    // terminal and failed.
    else if (
      environment.deploymentRequired &&
      operation?.buildArtifact &&
      operation.status === 'failed'
    ) {
      status = 'failed';
    } else if (environment.deploymentRequired) {
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

  if (status === 'running' && !ciStages.every((stage) => stage.status === 'success')) {
    status = 'pending';
  }
  return [...visibleStages, { name: 'publish', status, url: null, source: 'platform' }];
}
