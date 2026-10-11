import { config } from '../config';
import {
  ProjectScmFields,
  ScmBuildArtifact,
  ScmRepositoryRef,
  repositoryRef,
} from '../scm/scm-provider';

/**
 * Docker-safe workload key derived from the repository coordinates. Only the
 * creation of a project and rows without a stored key may call it: once
 * stored, the key no longer follows the coordinates (ADR-155).
 */
export function deploymentSlug(repository: Pick<ScmRepositoryRef, 'owner' | 'name'>): string {
  return `${repository.owner}-${repository.name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Workload identity on every target: container names, SFTP paths and Agent
 * workloads. A rename never changes it. A row written before the key was
 * stored derives the value the migration would have stored.
 */
export function workloadKey(project: ProjectScmFields & { deploymentKey?: string | null }): string {
  return project.deploymentKey || deploymentSlug(repositoryRef(project));
}

/**
 * Image reference of a verified build. The archive is tagged with the
 * repository name of its build, so the reference stored at ingestion wins over
 * one recomputed from coordinates that may have changed since (ADR-155).
 */
export function storedArtifactImageRef(
  repository: ScmRepositoryRef,
  artifact: Pick<ScmBuildArtifact, 'commitSha' | 'providerRunId'> & { imageRef?: string | null },
): string {
  return artifact.imageRef || artifactImageRef(repository, artifact);
}

/**
 * An environment on a user-owned Docker target is deployed by its Agent, which
 * downloads the stored archive itself. Only the other environments need the
 * image inside the control plane's own Docker daemon.
 */
export function isAgentBackedEnvironment(environment: {
  provider: string;
  target?: { scope: string } | null;
}): boolean {
  return environment.provider === 'docker' && environment.target?.scope === 'user';
}

/** Registry repository without a tag. */
export function imageRepository(repository: ScmRepositoryRef): string {
  const registry = repository.provider === 'github' ? 'ghcr.io' : config.registry.host;
  return `${registry}/${repository.owner}/${repository.name}`.toLowerCase();
}

/** Registry image tag produced by Gitea CI for a source commit. */
export function registryImageRef(repository: ScmRepositoryRef, version: string): string {
  return `${imageRepository(repository)}:${version}`;
}

/** Immutable GitHub Actions image identity includes both commit and run. */
export function artifactImageRef(
  repository: ScmRepositoryRef,
  artifact: Pick<ScmBuildArtifact, 'commitSha' | 'providerRunId'>,
): string {
  return `${imageRepository(repository)}:${artifact.commitSha}-${artifact.providerRunId}`;
}

export function deployedImageRef(
  repository: ScmRepositoryRef,
  environment: {
    version: string | null;
    buildArtifact?: { commitSha: string; providerRunId: string; imageRef?: string | null } | null;
  },
): string | undefined {
  if (!environment.version || !/^[0-9a-f]{40}$/i.test(environment.version)) return undefined;
  if (environment.buildArtifact?.imageRef) return environment.buildArtifact.imageRef;
  if (repository.provider === 'github') {
    return environment.buildArtifact
      ? artifactImageRef(repository, environment.buildArtifact)
      : undefined;
  }
  return registryImageRef(repository, environment.version);
}
