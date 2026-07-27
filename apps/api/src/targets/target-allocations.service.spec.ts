import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { TargetAllocationsService } from './target-allocations.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

// A real WorkspacesService gives us the genuine role→permission matrix; only its
// prisma membership lookup is stubbed per test.
function workspacesWithRole(role: string | null): WorkspacesService {
  const prisma = {
    workspaceMember: {
      findUnique: jest.fn(async () => (role ? { role } : null)),
      findFirst: jest.fn(async () => (role ? { workspaceId: 'ws-1', role } : null)),
    },
  };
  return new WorkspacesService(prisma as never, {} as never);
}

function makeService(prisma: Record<string, unknown>, role: string | null) {
  return new TargetAllocationsService(prisma as never, workspacesWithRole(role));
}

const allocationRow = {
  id: 'alloc-1',
  targetId: 'tgt-1',
  workspaceId: 'ws-1',
  namespace: 'acme',
  rootPath: null,
  publicUrl: 'http://host:8085',
  capabilities: 'static',
  status: 'active',
  maxEnvironments: 50,
  target: { name: 'Company static host', capabilities: 'static,php' },
  _count: { environments: 0 },
};

describe('TargetAllocationsService authorization (ADR-060 P2.4)', () => {
  it('lets an admin create an allocation for a usable target', async () => {
    const create = jest.fn(async () => ({ ...allocationRow }));
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'tgt-1', scope: 'builtin', workspaceId: null,
          capabilities: 'static,php', remotePath: null, publicUrl: 'http://host:8085',
        })),
      },
      targetAllocation: { findUnique: jest.fn(async () => null), create },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = makeService(prisma, 'admin');

    const res = await service.create('u1', { targetId: 'tgt-1', capabilities: ['static'] }, 'ws-1');

    expect(res.namespace).toBe('acme');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          capabilities: 'static',
          namespace: 'acme',
          rootPath: null,
          publicUrl: 'http://host:8085/acme',
        }),
      }),
    );
  });

  it('forbids a member (403) from creating an allocation', async () => {
    const prisma = {
      target: { findUnique: jest.fn() },
      targetAllocation: { findUnique: jest.fn(), create: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn() },
    };
    const service = makeService(prisma, 'member');

    await expect(
      service.create('u1', { targetId: 'tgt-1' }, 'ws-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.targetAllocation.create).not.toHaveBeenCalled();
  });

  it('rejects capabilities the target does not offer', async () => {
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'tgt-1', scope: 'builtin', workspaceId: null,
          capabilities: 'static', remotePath: null, publicUrl: null,
        })),
      },
      targetAllocation: { findUnique: jest.fn(async () => null), create: jest.fn() },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = makeService(prisma, 'owner');

    await expect(
      service.create('u1', { targetId: 'tgt-1', capabilities: ['php'] }, 'ws-1'),
    ).rejects.toThrow(/not offered by the target/);
  });

  it('hides an allocation in another workspace as 404 (not 403)', async () => {
    const prisma = {
      targetAllocation: { findUnique: jest.fn(async () => ({ ...allocationRow })) },
    };
    // Caller is not a member of ws-1 → roleFor returns null.
    const service = makeService(prisma, null);

    await expect(service.get('alloc-1', 'stranger')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets any member read an allocation in their workspace', async () => {
    const prisma = {
      targetAllocation: { findUnique: jest.fn(async () => ({ ...allocationRow })) },
    };
    const service = makeService(prisma, 'viewer');

    const res = await service.get('alloc-1', 'u1');
    expect(res.id).toBe('alloc-1');
    expect(res.inUse).toBe(0);
  });

  it('blocks deleting an allocation still in use', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({ ...allocationRow })),
        delete: jest.fn(),
      },
      environment: { count: jest.fn(async () => 2) },
    };
    const service = makeService(prisma, 'admin');

    await expect(service.remove('alloc-1', 'u1')).rejects.toThrow(/used by 2 environment/);
    expect(prisma.targetAllocation.delete).not.toHaveBeenCalled();
  });
});
