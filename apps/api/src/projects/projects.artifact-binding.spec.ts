import { ProjectsService } from './projects.service';
import { config } from '../config';

const projectRow = {
  id: 'project-1',
  scmProvider: 'github',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: 'installation-1',
  repoUrl: 'https://github.com/acme/api',
};

function make(
  prisma: Record<string, unknown>,
  deployment: Record<string, unknown> = {},
  workspaceScm: Record<string, unknown> = {},
  artifactStore: Record<string, unknown> = {},
) {
  return new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    deployment as never,
    {} as never,
    workspaceScm as never,
    {} as never,
    {} as never,
    artifactStore as never,
  );
}

describe('ProjectsService immutable artifact binding', () => {
  const savedPublicUrl = config.ci.publicUrl;

  afterEach(() => {
    config.ci.publicUrl = savedPublicUrl;
  });

  it('promotes the exact artifact currently running in the source environment', async () => {
    const prisma = {
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({ buildArtifactId: 'artifact-1' })),
      },
    };
    const service = make(prisma);
    jest.spyOn(service, 'get').mockResolvedValue({
      id: 'project-1',
      environments: [
        { name: 'dev', status: 'running', version: 'a'.repeat(40), artifact: { id: 'artifact-1' } },
      ],
    } as never);
    const schedule = jest.spyOn(service as any, 'scheduleDeployment').mockResolvedValue(undefined);

    await service.promote('project-1', 'test');

    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'test',
      'a'.repeat(40),
      true,
      'promote',
      'artifact-1',
      undefined,
    );
  });

  it('reuses a failed GitHub deployment when the cached image is present (no rehydration)', async () => {
    const sha = 'a'.repeat(40);
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          status: 'failed',
          activeOperationId: null,
        })),
      },
      project: { findUniqueOrThrow: jest.fn(async () => projectRow) },
      deploymentOperation: {
        findFirst: jest.fn(async () => ({
          version: sha,
          buildArtifactId: 'artifact-1',
        })),
      },
      buildArtifact: {
        // storageRef is now the opaque object key; the Docker ref is derived
        // from commitSha + providerRunId (ADR-059 §6).
        findFirst: jest.fn(async () => ({
          storageRef: 'artifacts/ws/pr/artifact-1/dig.tar',
          storageKind: 'object-store',
          status: 'available',
          commitSha: sha,
          providerRunId: 'run-1',
          digest: 'd'.repeat(64),
        })),
      },
    };
    const deployment = { hasImage: jest.fn(async () => true) };
    const service = make(prisma, deployment);
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
    const schedule = jest.spyOn(service as any, 'scheduleDeployment').mockResolvedValue(undefined);

    await service.runAgain('project-1');

    // Reuses the derived Docker ref directly; the store is never touched.
    expect(deployment.hasImage).toHaveBeenCalledWith(`ghcr.io/acme/api:${sha}-run-1`);
    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'dev',
      sha,
      true,
      'retry',
      'artifact-1',
      undefined,
    );
  });

  it('redeploys the verified artifact after a successful remove without starting CI again', async () => {
    const sha = 'a'.repeat(40);
    const giteaProject = {
      ...projectRow,
      scmProvider: 'gitea',
      scmRepositoryId: '77',
      scmOwner: 'alice',
      scmRepositoryName: 'api',
      scmFullName: 'alice/api',
      scmInstallationId: null,
      repoUrl: 'http://gitea:3000/alice/api',
    };
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          status: 'empty',
          activeOperationId: null,
        })),
      },
      project: { findUniqueOrThrow: jest.fn(async () => giteaProject) },
      deploymentOperation: {
        findFirst: jest.fn(async () => ({
          kind: 'remove',
          status: 'succeeded',
          version: sha,
          buildArtifactId: 'artifact-1',
        })),
      },
    };
    const service = make(prisma);
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
    const schedule = jest.spyOn(service as any, 'scheduleDeployment').mockResolvedValue(undefined);

    await service.runAgain('project-1');

    expect(prisma.deploymentOperation.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        environmentId: 'env-1',
        version: { not: null },
        OR: expect.arrayContaining([expect.objectContaining({ buildArtifactId: { not: null } })]),
      }),
      orderBy: { createdAt: 'desc' },
    });
    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'dev',
      sha,
      true,
      'redeploy',
      'artifact-1',
      undefined,
    );
  });

  it('rehydrates the verified image from object storage when the daemon cache is gone', async () => {
    const sha = 'a'.repeat(40);
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          status: 'failed',
          activeOperationId: null,
        })),
      },
      project: { findUniqueOrThrow: jest.fn(async () => projectRow) },
      deploymentOperation: {
        findFirst: jest.fn(async () => ({ version: sha, buildArtifactId: 'artifact-1' })),
      },
      buildArtifact: {
        findFirst: jest.fn(async () => ({
          storageRef: 'artifacts/ws/pr/artifact-1/dig.tar',
          storageKind: 'object-store',
          status: 'available',
          commitSha: sha,
          providerRunId: 'run-1',
          digest: 'd'.repeat(64),
        })),
      },
    };
    // Cache miss on first check; loadImageArchive succeeds after rehydration.
    const deployment = {
      hasImage: jest.fn(async () => false),
      loadImageArchive: jest.fn(async () => undefined),
    };
    const service = make(prisma, deployment);
    // Force the digest check to pass without a real download.
    const artifacts = (service as any).artifactLifecycle;
    jest.spyOn(artifacts, 'rehydrateImage').mockResolvedValue(true);
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
    const schedule = jest.spyOn(service as any, 'scheduleDeployment').mockResolvedValue(undefined);

    await service.runAgain('project-1');

    expect(artifacts.rehydrateImage).toHaveBeenCalledWith(
      'artifacts/ws/pr/artifact-1/dig.tar',
      `ghcr.io/acme/api:${sha}-run-1`,
      'd'.repeat(64),
    );
    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'dev',
      sha,
      true,
      'retry',
      'artifact-1',
      undefined,
    );
  });

  it('recovers an existing tested GitHub artifact instead of starting CI again', async () => {
    const sha = 'a'.repeat(40);
    const artifact = {
      provider: 'github-actions',
      providerArtifactId: '901',
      providerRunId: '456',
      name: 'initpad-image.tar',
      digest: 'd'.repeat(64),
      commitSha: sha,
      sizeBytes: 123,
      expiresAt: new Date('2026-07-21T00:00:00Z'),
    };
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          status: 'failed',
          activeOperationId: null,
          provider: 'sftp',
          target: { name: 'ESO' },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      project: {
        findUniqueOrThrow: jest.fn(async () => projectRow),
        findUnique: jest.fn(async () => ({ ...projectRow, owner: null })),
      },
      deploymentOperation: { findFirst: jest.fn(async () => null) },
    };
    const scm = {
      listCommits: jest.fn(async () => [{ sha }]),
      findBuildArtifact: jest.fn(async () => artifact),
      createRetryTag: jest.fn(),
    };
    const service = make(prisma, {}, { provider: jest.fn(() => scm) });
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
    jest.spyOn((service as any).operations, 'begin').mockResolvedValue('operation-1');
    const queue = jest
      .spyOn((service as any).artifactIngestion, 'queue')
      .mockResolvedValue(undefined);

    await service.runAgain('project-1');

    expect(scm.findBuildArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', fullName: 'acme/api' }),
      sha,
      'initpad-image.tar',
    );
    expect(queue).toHaveBeenCalledWith('project-1', expect.anything(), artifact, 'operation-1');
    expect(scm.createRetryTag).not.toHaveBeenCalled();
  });

  it('does not start another GitHub workflow when callback is local and no artifact exists', async () => {
    config.ci.publicUrl = 'http://localhost:8080';
    const sha = 'a'.repeat(40);
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          status: 'failed',
          activeOperationId: null,
          provider: 'sftp',
          target: { name: 'ESO' },
        })),
      },
      project: {
        findUniqueOrThrow: jest.fn(async () => projectRow),
        findUnique: jest.fn(async () => ({ ...projectRow, owner: null })),
      },
      deploymentOperation: { findFirst: jest.fn(async () => null) },
    };
    const scm = {
      listCommits: jest.fn(async () => [{ sha }]),
      findBuildArtifact: jest.fn(async () => null),
      createRetryTag: jest.fn(),
    };
    const service = make(prisma, {}, { provider: jest.fn(() => scm) });

    await expect(service.runAgain('project-1')).rejects.toThrow(
      'No reusable tested artifact was found',
    );
    expect(scm.createRetryTag).not.toHaveBeenCalled();
  });

  it('refreshes the callback secret and re-runs failed jobs of the bound artifact run', async () => {
    config.ci.publicUrl = 'https://initpad.example';
    const sha = 'a'.repeat(40);
    const prisma = {
      project: {
        findUniqueOrThrow: jest.fn(async () => projectRow),
        findUnique: jest.fn(async () => ({ ...projectRow, owner: null })),
      },
      environment: {
        findUnique: jest.fn(async () => ({
          version: sha,
          status: 'running',
          deploymentRequired: false,
          buildArtifact: { providerRunId: '29771743929' },
        })),
      },
    };
    const scm = {
      listCommitStatuses: jest.fn(async () => [
        {
          context: 'deploy',
          status: 'failure',
          targetUrl: 'https://github.example/job/1',
        },
      ]),
      configureRepoRuntimeSecrets: jest.fn(async () => undefined),
      rerunFailedJobs: jest.fn(async () => undefined),
    };
    const service = make(prisma, {}, { provider: jest.fn(() => scm) });

    await expect(service.rerunFailedJobs('project-1')).resolves.toEqual({
      runId: '29771743929',
    });

    expect(scm.listCommitStatuses).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', fullName: 'acme/api' }),
      sha,
      expect.anything(),
      '29771743929',
    );
    expect(scm.configureRepoRuntimeSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/api' }),
    );
    expect(scm.rerunFailedJobs).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/api' }),
      '29771743929',
    );
  });

  it('does not re-run GitHub jobs while the verified build still needs publication', async () => {
    config.ci.publicUrl = 'https://initpad.example';
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => projectRow) },
      environment: {
        findUnique: jest.fn(async () => ({
          version: 'a'.repeat(40),
          status: 'failed',
          deploymentRequired: true,
          buildArtifact: { providerRunId: '77' },
        })),
      },
    };
    const scm = { rerunFailedJobs: jest.fn() };
    const service = make(prisma, {}, { provider: jest.fn(() => scm) });

    await expect(service.rerunFailedJobs('project-1')).rejects.toThrow(
      'Publish the verified build successfully',
    );
    expect(scm.rerunFailedJobs).not.toHaveBeenCalled();
  });
});
