import { hashToken } from '../common/token';
import { ProjectReconciliation } from './project-reconciliation';
import { ProjectsService } from './projects.service';

describe('ProjectsService failed CI handoff', () => {
  it('closes the deployment operation instead of leaving dev deploying', async () => {
    const token = 'repository-callback-secret';
    const sha = 'a'.repeat(40);
    const project = {
      id: 'project-1',
      ciDeployTokenHash: hashToken(token),
      lastCommit: 'init',
      scmProvider: 'gitea',
      scmRepositoryId: '42',
      scmOwner: 'acme',
      scmRepositoryName: 'api',
      scmFullName: 'acme/api',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'http://gitea/acme/api',
    };
    const env = {
      id: 'env-1',
      projectId: project.id,
      name: 'dev',
      provider: 'docker',
      status: 'deploying',
      activeOperationId: null,
      target: { name: 'Built-in Docker' },
    };
    const prisma = {
      project: {
        findMany: jest.fn(async () => [project]),
        update: jest.fn(async () => project),
      },
      environment: {
        findUnique: jest.fn(async () => env),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      deploymentOperation: {
        create: jest.fn(async () => ({ id: 'operation-1' })),
        update: jest.fn(async () => ({ id: 'operation-1' })),
      },
    };
    const deployment = { deploy: jest.fn() };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      deployment as never,
      {} as never,
      { provider: jest.fn(() => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.deployFromCi('acme/api', sha, 'main', token, {
        ciStatus: 'failure',
      }),
    ).resolves.toBeUndefined();

    expect(deployment.deploy).not.toHaveBeenCalled();
    expect(prisma.deploymentOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'ci-deploy',
        status: 'running',
        version: sha,
      }),
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: env.id, activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'failed',
        deploymentRequired: true,
        activeOperationId: null,
        statusReason: expect.stringContaining('docker job: failure'),
      }),
    });
    expect(prisma.deploymentOperation.update).toHaveBeenCalledWith({
      where: { id: 'operation-1' },
      data: expect.objectContaining({
        status: 'failed',
        message: expect.stringContaining('docker job: failure'),
      }),
    });
  });

  it('reconciles a legacy workflow failure when no callback arrived', async () => {
    const sha = 'b'.repeat(40);
    const project = {
      id: 'project-legacy',
      templateId: 'node-api',
      owner: null,
      scmProvider: 'gitea',
      scmRepositoryId: '43',
      scmOwner: 'acme',
      scmRepositoryName: 'legacy',
      scmFullName: 'acme/legacy',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'http://gitea/acme/legacy',
    };
    const dev = {
      id: 'env-legacy',
      status: 'deploying',
      activeOperationId: null,
    };
    const prisma = {
      project: {
        findUnique: jest.fn(async () => project),
      },
      environment: {
        findUnique: jest.fn(async () => dev),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      deploymentOperation: { findUnique: jest.fn() },
    };
    const scm = {
      repoMissing: jest.fn(async () => false),
      listCommits: jest.fn(async () => [{ sha, message: 'broken', author: 'Dev', date: 'now' }]),
      listCommitStatuses: jest.fn(async () => [
        { context: 'ci / build (push)', status: 'failure', targetUrl: 'http://gitea/run/1' },
      ]),
    };
    const reconciliation = new ProjectReconciliation(
      prisma as never,
      { get: jest.fn(() => ({ artifact: 'runtime' })) } as never,
      { provider: jest.fn(() => scm) } as never,
      { complete: jest.fn() } as never,
      () => ({ username: 'acme', token: '' }),
      jest.fn(async () => undefined),
    );

    await expect(reconciliation.reconcileProjectScmState(project)).resolves.toBeUndefined();

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: {
        id: dev.id,
        status: 'deploying',
        activeOperationId: null,
      },
      data: expect.objectContaining({
        status: 'failed',
        deploymentRequired: true,
        activeOperationId: null,
        statusReason: expect.stringContaining('(build)'),
      }),
    });
  });
});
