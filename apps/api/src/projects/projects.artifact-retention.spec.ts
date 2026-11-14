import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';

type Refs = {
  environments?: string[];
  requests?: string[];
  unfinished?: string[];
  publishedTo?: string[];
  rollbackPoints?: string[];
};

// One mock per reference query. Each query receives the whole batch of ids.
function make(
  stale: Array<{ id: string; storageRef: string | null }> | jest.Mock,
  refs: Refs,
  artifactStore: Record<string, unknown>,
) {
  const rows = (ids: string[] = []) => ids.map((buildArtifactId) => ({ buildArtifactId }));
  const prisma = {
    buildArtifact: {
      findMany:
        typeof stale === 'function'
          ? stale
          : jest.fn().mockResolvedValueOnce(stale).mockResolvedValue([]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    environment: { findMany: jest.fn(async () => rows(refs.environments)) },
    productionDeploymentRequest: { findMany: jest.fn(async () => rows(refs.requests)) },
    deploymentOperation: {
      findMany: jest
        .fn()
        .mockImplementation(async ({ where }: { where: { finishedAt?: null } }) =>
          'finishedAt' in where
            ? rows(refs.unfinished)
            : (refs.publishedTo ?? []).map((environmentId) => ({ environmentId })),
        ),
    },
    $queryRaw: jest.fn(async () => rows(refs.rollbackPoints)),
  };
  const service = new ProjectArtifactLifecycle(
    prisma as never,
    artifactStore as never,
    {} as never,
  );
  return { service, prisma };
}

describe('ProjectArtifactLifecycle.runRetention', () => {
  it('deletes the object and demotes the row for an unreferenced expired artifact', async () => {
    const del = jest.fn(async () => undefined);
    const { service, prisma } = make(
      [{ id: 'a1', storageRef: 'artifacts/ws/pr/a1/d.tar' }],
      {},
      { delete: del },
    );

    await expect(service.runRetention()).resolves.toEqual({ removed: 1, kept: 0 });
    expect(del).toHaveBeenCalledWith('artifacts/ws/pr/a1/d.tar');
    expect(prisma.buildArtifact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ status: 'failed', storageKind: null, storageRef: null }),
      }),
    );
  });

  it.each([
    ['an environment', { environments: ['a1'] }],
    ['an unfinished deployment operation', { unfinished: ['a1'] }],
    ['a pending production request', { requests: ['a1'] }],
  ])('protects an artifact still referenced by %s', async (_label, refs) => {
    const del = jest.fn();
    const { service, prisma } = make([{ id: 'a1', storageRef: 'k' }], refs, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(del).not.toHaveBeenCalled();
    expect(prisma.buildArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('counts only pending and approving production requests as references', async () => {
    const { service, prisma } = make(
      [{ id: 'a1', storageRef: 'k' }],
      { requests: ['a1'] },
      {
        delete: jest.fn(),
      },
    );

    await service.runRetention();

    expect(prisma.productionDeploymentRequest.findMany).toHaveBeenCalledWith({
      where: { buildArtifactId: { in: ['a1'] }, status: { in: ['pending', 'approving'] } },
      select: { buildArtifactId: true },
    });
  });

  it('keeps the row when the object delete fails (no false success)', async () => {
    const del = jest.fn(async () => {
      throw new Error('storage offline');
    });
    const { service, prisma } = make([{ id: 'a1', storageRef: 'k' }], {}, { delete: del });

    await expect(service.runRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(prisma.buildArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the query to expired object-store artifacts in bounded batches', async () => {
    const findMany = jest.fn(async () => []);
    const { service } = make(findMany, {}, { delete: jest.fn() });
    const now = new Date('2026-07-20T00:00:00Z');

    await service.runRetention(now);

    const arg = (
      findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; take: number }]
    )[0];
    expect(arg.where).toMatchObject({ storageKind: 'object-store' });
    expect(arg.where).toHaveProperty('createdAt');
    expect(arg.take).toBe(100);
  });

  it('checks references once per batch instead of once per artifact', async () => {
    // Regression (audit P2): every expired artifact cost up to 5 + N queries.
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `a${String(index).padStart(3, '0')}`,
      storageRef: `k${index}`,
    }));
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ id: 'z1', storageRef: 'z1' }])
      .mockResolvedValue([]);
    const { service, prisma } = make(
      findMany,
      { publishedTo: ['dev'], rollbackPoints: ['a001'] },
      { delete: jest.fn(async () => undefined) },
    );

    await expect(service.runRetention()).resolves.toEqual({ removed: 100, kept: 1 });

    expect(findMany).toHaveBeenCalledTimes(2);
    // The second batch continues after the last id of the first one.
    expect(findMany.mock.calls[1][0].where.id).toEqual({ gt: 'a099' });
    expect(prisma.environment.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('protects exactly the newest previous successful artifact for rollback', async () => {
    const del = jest.fn(async () => undefined);
    const { service, prisma } = make(
      [
        { id: 'previous', storageRef: 'previous.tar' },
        { id: 'older', storageRef: 'older.tar' },
      ],
      { publishedTo: ['dev'], rollbackPoints: ['previous'] },
      { delete: del },
    );

    await expect(service.runRetention()).resolves.toEqual({ removed: 1, kept: 1 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('older.tar');
    expect(prisma.buildArtifact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'older' } }),
    );
  });

  it('skips the rollback-point query when no artifact in the batch was published', async () => {
    const { service, prisma } = make(
      [{ id: 'a1', storageRef: 'k' }],
      {},
      {
        delete: jest.fn(async () => undefined),
      },
    );

    await service.runRetention();

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
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
    const service = new ProjectArtifactLifecycle(
      prisma as never,
      { delete: del } as never,
      {} as never,
    );

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
    const service = new ProjectArtifactLifecycle(
      prisma as never,
      { delete: del } as never,
      {} as never,
    );

    await expect(service.purgeProjectObjects('project')).resolves.toEqual([
      'artifacts/ws/project/blocked.tar: access denied',
    ]);
    expect(del).toHaveBeenCalledTimes(2);
  });
});
