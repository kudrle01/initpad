import { ProjectEnvironmentTargets } from './project-environment-targets';

function make(prisma: Record<string, unknown>) {
  return new ProjectEnvironmentTargets(prisma as never, {} as never);
}

describe('ProjectEnvironmentTargets.reconcileAllocations (ADR-060 backfill)', () => {
  it('creates one allocation per (workspace,target) pair and links the environment', async () => {
    const create = jest.fn(async () => ({ id: 'alloc-1' }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      environment: {
        findMany: jest.fn(async () => [
          { id: 'env-1', targetId: 'tgt-1', project: { workspaceId: 'ws-1' } },
        ]),
        updateMany,
      },
      targetAllocation: {
        findUnique: jest.fn(async () => null),
        create,
      },
      target: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'tgt-1',
          remotePath: '/var/www/app',
          publicUrl: 'http://host:8085',
          capabilities: 'static,php',
        })),
      },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = make(prisma);

    await service.reconcileAllocations();

    // Allocation mirrors the target so existing URLs/paths are unchanged.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          targetId: 'tgt-1',
          namespace: 'acme',
          rootPath: '/var/www/app',
          publicUrl: 'http://host:8085',
          capabilities: 'static,php',
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'env-1', allocationId: null },
      data: { allocationId: 'alloc-1' },
    });
  });

  it('reuses an existing allocation instead of creating a duplicate', async () => {
    const create = jest.fn();
    const prisma = {
      environment: {
        findMany: jest.fn(async () => [
          { id: 'env-1', targetId: 'tgt-1', project: { workspaceId: 'ws-1' } },
          { id: 'env-2', targetId: 'tgt-1', project: { workspaceId: 'ws-1' } },
        ]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      targetAllocation: {
        findUnique: jest.fn(async () => ({ id: 'alloc-existing' })),
        create,
      },
      target: { findUniqueOrThrow: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn() },
    };
    const service = make(prisma);

    await service.reconcileAllocations();

    expect(create).not.toHaveBeenCalled();
    expect(prisma.target.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('reuses the allocation created by a concurrent project request', async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'alloc-winner',
      targetId: 'tgt-1',
      namespace: 'acme',
      rootPath: '/var/www/acme',
      publicUrl: 'http://host/acme',
      capabilities: 'node',
      status: 'active',
      maxEnvironments: 50,
    });
    const prisma = {
      targetAllocation: {
        findUnique,
        create: jest.fn(async () => {
          throw new Error('unique constraint');
        }),
      },
      target: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'tgt-1',
          kind: 'docker',
          remotePath: null,
          publicUrl: 'http://host',
          capabilities: 'node',
        })),
      },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = make(prisma);

    await expect(service.ensureAllocation('ws-1', 'tgt-1')).resolves.toEqual(
      expect.objectContaining({ id: 'alloc-winner' }),
    );
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when every environment is already linked', async () => {
    const prisma = {
      environment: {
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(),
      },
      targetAllocation: { findUnique: jest.fn(), create: jest.fn() },
      target: { findUniqueOrThrow: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn() },
    };
    const service = make(prisma);

    await service.reconcileAllocations();

    expect(prisma.targetAllocation.findUnique).not.toHaveBeenCalled();
    expect(prisma.environment.updateMany).not.toHaveBeenCalled();
  });

  it('skips environments without a target', async () => {
    const prisma = {
      environment: {
        findMany: jest.fn(async () => [
          { id: 'env-1', targetId: null, project: { workspaceId: 'ws-1' } },
        ]),
        updateMany: jest.fn(),
      },
      targetAllocation: { findUnique: jest.fn(), create: jest.fn() },
      target: { findUniqueOrThrow: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn() },
    };
    const service = make(prisma);

    await service.reconcileAllocations();

    expect(prisma.targetAllocation.findUnique).not.toHaveBeenCalled();
  });
});
