import { hashToken } from '../common/token';
import { ProjectCiOrchestrator } from './project-ci-orchestrator';
import { ActiveOperationConflict } from './project-deployment-operations';

// Regression suite for audit P1.13: a second push while dev was deploying was
// rejected with HTTP 400 and lost. The newest successful build is now queued
// and deployed once dev is free (ADR-178).

const TOKEN = 'repository-callback-secret';
const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);
const PROJECT = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  lastCommit: 'ci: deploy aaaaaaa',
  ciDeployTokenHash: hashToken(TOKEN),
  scmProvider: 'gitea',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: null,
  repoUrl: 'http://gitea.test/acme/api',
};

function make(dev: Record<string, unknown>) {
  const prisma = {
    project: {
      findMany: jest.fn(async () => [PROJECT]),
      findUnique: jest.fn(async () => PROJECT),
      update: jest.fn(async () => PROJECT),
    },
    environment: {
      findUnique: jest.fn(async () => dev),
      findMany: jest.fn(async (): Promise<Array<Record<string, unknown>>> => []),
      update: jest.fn(async () => dev),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    buildArtifact: { findUnique: jest.fn(async () => null) },
    deploymentOperation: { findUnique: jest.fn(async () => null) },
  };
  const operations = {
    begin: jest.fn(async () => 'operation-2'),
    complete: jest.fn(async () => undefined),
  };
  const scheduleDeployment = jest.fn(async () => undefined);
  const orchestrator = new ProjectCiOrchestrator(
    prisma as never,
    { provider: jest.fn(() => ({ deleteTag: jest.fn() })) } as never,
    operations as never,
    { queue: jest.fn(), queueVerification: jest.fn() } as never,
    jest.fn(async () => ({ username: 'alice', token: 'token' })),
    jest.fn(async () => undefined),
    scheduleDeployment,
    jest.fn(async () => undefined),
  );
  return { orchestrator, prisma, operations, scheduleDeployment };
}

const BUSY_DEV = {
  id: 'env-dev',
  status: 'deploying',
  activeOperationId: 'operation-1',
};

describe('ProjectCiOrchestrator latest-wins dev queue', () => {
  it('queues a push that arrives while dev is busy instead of rejecting it', async () => {
    const ctx = make(BUSY_DEV);

    await expect(
      ctx.orchestrator.deployFromCi('acme/api', NEW_SHA, 'main', TOKEN),
    ).resolves.toBeUndefined();

    expect(ctx.scheduleDeployment).not.toHaveBeenCalled();
    expect(ctx.operations.begin).not.toHaveBeenCalled();
    expect(ctx.prisma.environment.update).toHaveBeenCalledWith({
      where: { id: 'env-dev' },
      data: {
        pendingCiVersion: NEW_SHA,
        pendingCiArtifactId: null,
        pendingCiArtifactDigest: null,
        pendingCiQueuedAt: expect.any(Date),
      },
    });
    expect(ctx.prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { lastCommit: 'ci: queued bbbbbbb' },
    });
  });

  it('keeps only the newest queued build', async () => {
    const ctx = make(BUSY_DEV);

    await ctx.orchestrator.deployFromCi('acme/api', OLD_SHA, 'main', TOKEN);
    await ctx.orchestrator.deployFromCi('acme/api', NEW_SHA, 'main', TOKEN);

    const writes = ctx.prisma.environment.update.mock.calls as unknown as Array<
      [{ data: { pendingCiVersion: string } }]
    >;
    expect(writes.map(([call]) => call.data.pendingCiVersion)).toEqual([OLD_SHA, NEW_SHA]);
  });

  it('queues the build when another request claims dev between the read and begin', async () => {
    const ctx = make({ ...BUSY_DEV, activeOperationId: null, status: 'running' });
    ctx.scheduleDeployment.mockRejectedValueOnce(new ActiveOperationConflict('dev'));

    await expect(
      ctx.orchestrator.deployFromCi('acme/api', NEW_SHA, 'main', TOKEN),
    ).resolves.toBeUndefined();

    expect(ctx.prisma.environment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pendingCiVersion: NEW_SHA }),
      }),
    );
  });

  it('records no operation for a failed build while dev is busy', async () => {
    const ctx = make(BUSY_DEV);

    await ctx.orchestrator.deployFromCi('acme/api', NEW_SHA, 'main', TOKEN, {
      ciStatus: 'failure',
    });

    expect(ctx.operations.begin).not.toHaveBeenCalled();
    expect(ctx.operations.complete).not.toHaveBeenCalled();
    expect(ctx.prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { lastCommit: 'ci: failed bbbbbbb' },
    });
  });

  it('deploys the queued build once dev is free', async () => {
    const queuedAt = new Date('2026-11-14T10:00:00Z');
    const ctx = make(BUSY_DEV);
    ctx.prisma.environment.findMany.mockResolvedValueOnce([
      {
        id: 'env-dev',
        projectId: 'project-1',
        status: 'running',
        version: OLD_SHA,
        deploymentRequired: false,
        pendingCiVersion: NEW_SHA,
        pendingCiArtifactId: null,
        pendingCiArtifactDigest: null,
        pendingCiQueuedAt: queuedAt,
      },
    ]);

    await expect(ctx.orchestrator.drainPending()).resolves.toBe(1);

    expect(ctx.prisma.environment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'dev', pendingCiQueuedAt: { not: null }, activeOperationId: null },
      }),
    );
    // The claim is a compare-and-set on exactly the queued entry.
    expect(ctx.prisma.environment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'env-dev',
        activeOperationId: null,
        pendingCiQueuedAt: queuedAt,
        pendingCiVersion: NEW_SHA,
      },
      data: {
        pendingCiVersion: null,
        pendingCiArtifactId: null,
        pendingCiArtifactDigest: null,
        pendingCiQueuedAt: null,
      },
    });
    expect(ctx.scheduleDeployment).toHaveBeenCalledWith('project-1', NEW_SHA, 'ci-deploy');
  });

  it('drops a queued build after the user cancelled dev', async () => {
    const ctx = make(BUSY_DEV);
    ctx.prisma.environment.findMany.mockResolvedValueOnce([
      {
        id: 'env-dev',
        projectId: 'project-1',
        status: 'empty',
        version: null,
        deploymentRequired: false,
        pendingCiVersion: NEW_SHA,
        pendingCiArtifactId: null,
        pendingCiArtifactDigest: null,
        pendingCiQueuedAt: new Date(),
      },
    ]);

    await expect(ctx.orchestrator.drainPending()).resolves.toBe(0);
    expect(ctx.scheduleDeployment).not.toHaveBeenCalled();
  });

  it('puts a queued build back when dev became busy again during the drain', async () => {
    const queuedAt = new Date('2026-11-14T10:00:00Z');
    const ctx = make(BUSY_DEV);
    ctx.prisma.environment.findMany.mockResolvedValueOnce([
      {
        id: 'env-dev',
        projectId: 'project-1',
        status: 'running',
        version: OLD_SHA,
        deploymentRequired: false,
        pendingCiVersion: NEW_SHA,
        pendingCiArtifactId: null,
        pendingCiArtifactDigest: null,
        pendingCiQueuedAt: queuedAt,
      },
    ]);
    ctx.scheduleDeployment.mockRejectedValueOnce(new ActiveOperationConflict('dev'));

    await expect(ctx.orchestrator.drainPending()).resolves.toBe(0);

    expect(ctx.prisma.environment.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'env-dev', pendingCiQueuedAt: null },
      data: {
        pendingCiVersion: NEW_SHA,
        pendingCiArtifactId: null,
        pendingCiArtifactDigest: null,
        pendingCiQueuedAt: queuedAt,
      },
    });
  });
});
