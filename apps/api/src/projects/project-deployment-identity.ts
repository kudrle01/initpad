import { config } from '../config';
import { ScmBuildArtifact, ScmRepositoryRef } from '../scm/scm-provider';

/** Docker-safe workload key namespaced by immutable repository ownership. */
export function deploymentSlug(repository: ScmRepositoryRef): string {
  return `${repository.owner}-${repository.name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    buildArtifact?: { commitSha: string; providerRunId: string } | null;
  },
): string | undefined {
  if (!environment.version || !/^[0-9a-f]{40}$/i.test(environment.version)) return undefined;
  if (repository.provider === 'github') {
    return environment.buildArtifact
      ? artifactImageRef(repository, environment.buildArtifact)
      : undefined;
  }
  return registryImageRef(repository, environment.version);
}
