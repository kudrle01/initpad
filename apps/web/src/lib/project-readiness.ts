import type { Commit, DeploymentOperation, Project } from '@/types';

/** After this long without a first CI run the page stops promising "a few minutes". */
export const FIRST_PIPELINE_PATIENCE_MS = 15 * 60_000;

export type FirstPipelineState = 'none' | 'waiting' | 'running' | 'overdue';

/**
 * A freshly created project has a repository but nothing to show until its
 * first CI run starts: every environment is empty and the head commit has no
 * stage activity. Surfacing that window explicitly keeps users from reading
 * a quiet page as a broken one.
 */
export function firstPipelineState(
  project: Project | null,
  commits: Commit[],
  deployments: DeploymentOperation[],
  now = Date.now(),
): FirstPipelineState {
  if (!project || deployments.length > 0) return 'none';
  if (project.environments.some((environment) => environment.status !== 'empty')) return 'none';
  if (project.environments.some((environment) => environment.version)) return 'none';

  const head = commits[0];
  const stages = head?.pipeline ?? [];
  if (stages.some((stage) => stage.status === 'failed')) return 'none';
  if (stages.some((stage) => stage.status === 'running' || stage.status === 'success')) {
    return 'running';
  }

  const createdAt = Date.parse(project.createdAt);
  const age = Number.isFinite(createdAt) ? now - createdAt : 0;
  return age > FIRST_PIPELINE_PATIENCE_MS ? 'overdue' : 'waiting';
}
