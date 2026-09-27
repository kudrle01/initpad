import { Prisma } from '@prisma/client';
import {
  DeployStatus,
  EnvName,
  Project,
  PipelinePreset,
  ProviderKind,
  TargetManagementState,
  TargetScope,
} from '../domain/types';
import { ScmKind } from '../scm/scm-provider';
import { withCurrentPublicHost } from '../common/public-url';
import { pipelineStages } from './pipeline-preset';

export type ProjectRow = Prisma.ProjectGetPayload<{
  include: {
    environments: { include: { target: true; allocation: true; buildArtifact: true } };
    buildArtifacts: {
      where: { status: 'available' };
      orderBy: { createdAt: 'desc' };
      take: 1;
    };
  };
}>;

/** Maps the persistence model to the stable project API contract. */
export function projectView(row: ProjectRow, publicHost: string): Project {
  const configuredStages = new Set(pipelineStages(row.pipelinePreset as PipelinePreset));
  const latestVerifiedArtifact = row.buildArtifacts[0];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    templateId: row.templateId,
    repoPath: row.repoPath,
    repoUrl: row.repoUrl,
    scm: {
      provider: row.scmProvider as ScmKind,
      repositoryId: row.scmRepositoryId,
      owner: row.scmOwner,
      name: row.scmRepositoryName,
      fullName: row.scmFullName,
      defaultBranch: row.scmDefaultBranch,
      repoUrl: row.repoUrl,
      installationId: row.scmInstallationId,
    },
    createdAt: row.createdAt.toISOString(),
    lastCommit: row.lastCommit,
    pipelinePreset: row.pipelinePreset as PipelinePreset,
    latestVerifiedArtifact: latestVerifiedArtifact
      ? {
          id: latestVerifiedArtifact.id,
          version: latestVerifiedArtifact.commitSha,
          provider: latestVerifiedArtifact.sourceProvider,
          digest: latestVerifiedArtifact.digest,
          runId: latestVerifiedArtifact.providerRunId,
        }
      : null,
    environments: [...row.environments]
      .filter((environment) => configuredStages.has(environment.name as EnvName))
      .sort((a, b) => a.order - b.order)
      .map((environment) => ({
        name: environment.name as EnvName,
        provider: environment.provider as ProviderKind,
        status: environment.status as DeployStatus,
        version: environment.version,
        // A missing target is the pre-target-model representation of the
        // built-in provider; keep legacy projects correct as well.
        url:
          !environment.target || environment.target.scope === 'builtin'
            ? withCurrentPublicHost(environment.url, publicHost)
            : environment.url,
        statusReason: environment.statusReason,
        deploymentRequired: environment.deploymentRequired,
        expiresAt: environment.expiresAt?.toISOString() ?? null,
        expiryWarningAt: environment.expiryWarningAt?.toISOString() ?? null,
        artifact: environment.buildArtifact
          ? {
              id: environment.buildArtifact.id,
              provider: environment.buildArtifact.sourceProvider,
              digest: environment.buildArtifact.digest,
              runId: environment.buildArtifact.providerRunId,
            }
          : null,
        workspaceAccessStatus:
          environment.allocation?.status === 'active' ||
          environment.allocation?.status === 'disabled'
            ? environment.allocation.status
            : null,
        target: environment.target
          ? {
              id: environment.target.id,
              name: environment.target.name,
              kind: environment.target.kind as ProviderKind,
              scope: environment.target.scope as TargetScope,
              host: environment.target.host,
              managementState: (environment.target.managementState ??
                'active') as TargetManagementState,
            }
          : null,
      })),
  };
}
