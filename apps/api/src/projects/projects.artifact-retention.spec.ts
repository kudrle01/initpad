import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';

function make(prisma: Record<string, unknown>, artifactStore: Record<string, unknown>) {
  return new ProjectArtifactLifecycle(
    {
      productionDeploymentRequest: { count: jest.fn(async () => 0) },
      ...prisma,
    } as never,
    artifactStore as never,
    {} as never,
  );
}

describe('ProjectArtifactLifecycle.runRetention', () => {
  it('deletes the object and demotes the row for an unreferenced expired artifact', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'artifacts/ws/pr/a1/d.tar' }]),
        updateMany,
      },
      environment: { count: jest.fn(async () => 0) },
      deploymentOperation: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
    };
    const del = jest.fn(async () => undefined);
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 1, kept: 0 });
    expect(del).toHaveBeenCalledWith('artifacts/ws/pr/a1/d.tar');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ status: 'failed', storageKind: null, storageRef: null }),
      }),
    );
  });

  it('protects an artifact still referenced by an environment', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 1) },
      deploymentOperation: { count: jest.fn(async () => 0) },
    };
    const del = jest.fn();
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(del).not.toHaveBeenCalled();
    expect(prisma.buildArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('protects an artifact still needed by an unfinished deployment operation', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 0) },
      deploymentOperation: { count: jest.fn(async () => 1) },
    };
    const del = jest.fn();
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(del).not.toHaveBeenCalled();
  });

  it('protects an artifact referenced by a pending production request', async () => {
    const requestCount = jest.fn(async () => 1);
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 0) },
      productionDeploymentRequest: { count: requestCount },
      deploymentOperation: { count: jest.fn(async () => 0) },
    };
    const del = jest.fn();
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(requestCount).toHaveBeenCalledWith({
      where: { buildArtifactId: 'a1', status: { in: ['pending', 'approving'] } },
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('keeps the row when the object delete fails (no false success)', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 0) },
      deploymentOperation: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
    };
    const del = jest.fn(async () => {
      throw new Error('storage offline');
    });
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(prisma.buildArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the query to expired object-store artifacts only', async () => {
    const findMany = jest.fn(async () => []);
    const prisma = {
      buildArtifact: { findMany, updateMany: jest.fn() },
      environment: { count: jest.fn() },
      deploymentOperation: { count: jest.fn() },
    };
    const service = make(prisma, { delete: jest.fn() });
    const now = new Date('2026-07-20T00:00:00Z');

    await service.runRetention(now);

    const arg = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0];
    expect(arg.where).toMatchObject({ storageKind: 'object-store' });
    expect(arg.where).toHaveProperty('createdAt');
  });

  it('protects exactly the newest previous successful artifact for rollback', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'previous', storageRef: 'previous.tar' }]),
        updateMany: jest.fn(),
      },
      environment: {
        count: jest.fn(async () => 0),
        findUnique: jest.fn(async () => ({ buildArtifactId: 'current' })),
      },
      deploymentOperation: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => [{ environmentId: 'dev' }]),
        findFirst: jest.fn(async () => ({ buildArtifactId: 'previous' })),
      },
    };
    const del = jest.fn();
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(del).not.toHaveBeenCalled();
    expect(prisma.deploymentOperation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          environmentId: 'dev',
          NOT: { buildArtifactId: 'current' },
        }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('expires older successful artifacts beyond the single rollback point', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'older', storageRef: 'older.tar' }]),
        updateMany,
      },
      environment: {
        count: jest.fn(async () => 0),
        findUnique: jest.fn(async () => ({ buildArtifactId: 'current' })),
      },
      deploymentOperation: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => [{ environmentId: 'dev' }]),
        findFirst: jest.fn(async () => ({ buildArtifactId: 'previous' })),
      },
    };
    const del = jest.fn(async () => undefined);
    const service = make(prisma, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 1, kept: 0 });
    expect(del).toHaveBeenCalledWith('older.tar');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'older' } }));
  });

  it('purges every durable object belonging to a deleted project', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [
          { storageRef: 'artifacts/ws/project/a1/d1.tar' },
          { storageRef: 'artifacts/ws/project/a2/d2.tar' },
        ]),
      },
    };
    const del = jest.fn(async () => undefined);
    const service = make(prisma, { delete: del });

    await expect(service.purgeProjectObjects('project')).resolves.toEqual([]);
    expect(del).toHaveBeenCalledTimes(2);
    expect(prisma.buildArtifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'project' }) }),
    );
  });

  it('returns cleanup debt without hiding successful object deletions', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [
          { storageRef: 'artifacts/ws/project/ok.tar' },
          { storageRef: 'artifacts/ws/project/blocked.tar' },
        ]),
      },
    };
    const del = jest.fn(async (key: string) => {
      if (key.endsWith('blocked.tar')) throw new Error('access denied');
    });
    const service = make(prisma, { delete: del });

    await expect(service.purgeProjectObjects('project')).resolves.toEqual([
      'artifacts/ws/project/blocked.tar: access denied',
    ]);
    expect(del).toHaveBeenCalledTimes(2);
  });
});
