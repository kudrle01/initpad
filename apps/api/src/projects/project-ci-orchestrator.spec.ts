import { BadRequestException } from '@nestjs/common';
import { hashToken } from '../common/token';
import { ProjectCiOrchestrator } from './project-ci-orchestrator';

const TOKEN = 'repository-callback-secret';
const SHA = 'a'.repeat(40);
const PROJECT = {
  id: 'project-1',
  lastCommit: 'init',
  ciDeployTokenHash: hashToken(TOKEN),
  scmProvider: 'github',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: 'installation-1',
  repoUrl: 'https://github.com/acme/api',
};
const ARTIFACT = {
  provider: 'github-actions',
  providerArtifactId: '901',
  providerRunId: 'run-1',
  commitSha: SHA,
  name: 'initpad-image.tar',
  digest: 'd'.repeat(64),
  sizeBytes: 1024,
  expiresAt: new Date('2026-08-10T00:00:00Z'),
};

function make(
  options: {
    project?: Record<string, unknown>;
    dev?: Record<string, unknown>;
    replay?: Record<string, unknown> | null;
    scm?: Record<string, unknown>;
  } = {},
) {
  const project = options.project ?? PROJECT;
  const dev = options.dev ?? {
    id: 'env-1',
    status: 'deploying',
    activeOperationId: null,
  };
  const prisma = {
    project: {
      findMany: jest.fn(async () => [project]),
      update: jest.fn(async () => project),
    },
    environment: { findUnique: jest.fn(async () => dev) },
    buildArtifact: {
      findUnique: jest.fn(async () => options.replay ?? null),
    },
    deploymentOperation: {
      findUnique: jest.fn(async (): Promise<Record<string, unknown> | null> => null),
    },
  };
  const scm = options.scm ?? {
    resolveBuildArtifact: jest.fn(async () => ARTIFACT),
    downloadBuildArtifact: jest.fn(),
    deleteTag: jest.fn(async () => undefined),
  };
  const operations = {
    begin: jest.fn(async () => 'operation-1'),
    complete: jest.fn(async () => undefined),
  };
  const ingestion = { queue: jest.fn(async () => undefined) };
  const deployInBackground = jest.fn(async () => undefined);
  const scheduleDeployment = jest.fn(async () => undefined);
  const resolveActor = jest.fn(async () => ({ username: 'alice', token: 'token' }));
  const orchestrator = new ProjectCiOrchestrator(
    prisma as never,
    { provider: jest.fn(() => scm) } as never,
    operations as never,
    ingestion as never,
    resolveActor,
    deployInBackground,
    scheduleDeployment,
  );
  return {
    orchestrator,
    prisma,
    scm,
    operations,
    ingestion,
    deployInBackground,
    scheduleDeployment,
  };
}

describe('ProjectCiOrchestrator', () => {
  it('binds the resolved GitHub artifact to the deployment operation', async () => {
    const ctx = make();

    await ctx.orchestrator.deployFromCi('acme/api', SHA, 'main', TOKEN, {
      artifactId: ARTIFACT.providerArtifactId,
      artifactDigest: ARTIFACT.digest,
    });

    expect((ctx.scm as any).resolveBuildArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', repositoryId: '101' }),
      {
        providerArtifactId: '901',
        digest: ARTIFACT.digest,
        commitSha: SHA,
        expectedName: 'initpad-image.tar',
      },
    );
    expect(ctx.operations.begin).toHaveBeenCalledWith('project-1', 'dev', 'ci-deploy', SHA);
    expect(ctx.ingestion.queue).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ fullName: 'acme/api' }),
      ARTIFACT,
      'operation-1',
    );
    expect(ctx.scheduleDeployment).not.toHaveBeenCalled();
  });

  it('ignores an already accepted duplicate callback before creating an operation', async () => {
    const ctx = make({
      replay: {
        projectId: 'project-1',
        commitSha: SHA,
        status: 'available',
      },
    });

    await ctx.orchestrator.deployFromCi('acme/api', SHA, 'main', TOKEN, {
      artifactId: ARTIFACT.providerArtifactId,
      artifactDigest: ARTIFACT.digest,
    });

    expect(ctx.operations.begin).not.toHaveBeenCalled();
    expect(ctx.ingestion.queue).not.toHaveBeenCalled();
    expect(ctx.prisma.project.update).not.toHaveBeenCalled();
  });

  it('rejects replaying an artifact already bound to another project', async () => {
    const ctx = make({
      replay: {
        projectId: 'project-2',
        commitSha: SHA,
        status: 'available',
      },
    });

    await expect(
      ctx.orchestrator.deployFromCi('acme/api', SHA, 'main', TOKEN, {
        artifactId: ARTIFACT.providerArtifactId,
        artifactDigest: ARTIFACT.digest,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.ingestion.queue).not.toHaveBeenCalled();
  });

  it('accepts only the active InitPad retry and always removes its temporary tag', async () => {
    const giteaProject = {
      ...PROJECT,
      scmProvider: 'gitea',
      scmInstallationId: null,
      repoUrl: 'http://gitea/acme/api',
    };
    const ctx = make({
      project: giteaProject,
      dev: {
        id: 'env-1',
        status: 'deploying',
        activeOperationId: 'operation-retry',
      },
    });
    ctx.prisma.deploymentOperation.findUnique.mockResolvedValue({
      id: 'operation-retry',
      kind: 'ci-retry',
      status: 'running',
      version: SHA,
    });

    await ctx.orchestrator.deployFromCi('acme/api', SHA, 'refs/tags/initpad-retry-manual', TOKEN);

    expect(ctx.deployInBackground).toHaveBeenCalledWith('project-1', SHA, 'operation-retry');
    expect((ctx.scm as any).deleteTag).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/api' }),
      'initpad-retry-manual',
      expect.objectContaining({ username: 'alice' }),
    );
  });
});
