import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { TargetAllocationsService } from './target-allocations.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { config } from '../config';

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

function makeService(
  prisma: Record<string, unknown>,
  role: string | null,
  audit = { record: jest.fn(async () => undefined) },
) {
  return new TargetAllocationsService(prisma as never, workspacesWithRole(role), audit as never);
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
  cpuLimitMillicores: 1000,
  memoryLimitMb: 512,
  pidsLimit: 256,
  devTtlHours: null,
  testTtlHours: null,
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
    const audit = { record: jest.fn(async () => undefined) };
    const service = makeService(prisma, 'admin', audit);

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
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      actorUserId: 'u1',
      action: 'allocation.created',
      resourceType: 'allocation',
      resourceId: 'alloc-1',
      resourceName: 'Company static host',
      details: {
        targetId: 'tgt-1',
        capabilities: 'static',
        maxEnvironments: 50,
        cpuLimitMillicores: 1000,
        memoryLimitMb: 512,
        pidsLimit: 256,
        devTtlHours: 'disabled',
        testTtlHours: 'disabled',
      },
    });
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

  it('can reserve workspace access before a Docker Agent is ready', async () => {
    const create = jest.fn(async () => ({
      ...allocationRow,
      targetId: 'agent-target',
      target: {
        name: 'Remote Docker',
        capabilities: 'static,node,php,python',
        scope: 'user',
        managementState: 'active',
      },
    }));
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'agent-target',
          kind: 'docker',
          scope: 'user',
          workspaceId: 'ws-1',
          capabilities: 'static,node,php,python',
          agent: null,
        })),
      },
      targetAllocation: { findUnique: jest.fn(async () => null), create },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = makeService(prisma, 'owner');

    await expect(
      service.create('u1', { targetId: 'agent-target' }, 'ws-1'),
    ).resolves.toMatchObject({ targetId: 'agent-target' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('allocates a Docker target backed by a compatible enrolled Agent', async () => {
    const savedStore = { ...config.artifactStore };
    Object.assign(config.artifactStore, {
      bucket: 'test-artifacts',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
    });
    const create = jest.fn(async () => ({
      ...allocationRow,
      targetId: 'agent-target',
      target: { name: 'Remote Docker', capabilities: 'static,node' },
    }));
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'agent-target',
          kind: 'docker',
          scope: 'user',
          workspaceId: 'ws-1',
          capabilities: 'static,node',
          remotePath: null,
          publicUrl: 'https://apps.example.test',
          agent: { credentialHash: 'hash', disabledAt: null, version: '0.4.0' },
        })),
      },
      targetAllocation: { findUnique: jest.fn(async () => null), create },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = makeService(prisma, 'owner');

    try {
      await expect(
        service.create('u1', { targetId: 'agent-target' }, 'ws-1'),
      ).resolves.toMatchObject({ targetId: 'agent-target' });
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(config.artifactStore, savedStore);
    }
  });

  it('can configure managed-gateway workspace access before its runtime preflight', async () => {
    const create = jest.fn(async () => ({
      ...allocationRow,
      targetId: 'gateway-target',
      target: {
        name: 'Gateway Docker',
        capabilities: 'static,node',
        scope: 'user',
        managementState: 'active',
      },
    }));
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          id: 'gateway-target',
          kind: 'docker',
          scope: 'user',
          workspaceId: 'ws-1',
          capabilities: 'static,node',
          routingMode: 'managed-gateway',
          publicUrl: 'https://apps.example.test',
          agent: { credentialHash: 'hash', disabledAt: null, version: '0.7.0' },
        })),
      },
      targetAllocation: { findUnique: jest.fn(async () => null), create },
      workspace: { findUniqueOrThrow: jest.fn(async () => ({ slug: 'acme' })) },
    };
    const service = makeService(prisma, 'owner');

    await expect(
      service.create('u1', { targetId: 'gateway-target' }, 'ws-1'),
    ).resolves.toMatchObject({ targetId: 'gateway-target' });
    expect(create).toHaveBeenCalledTimes(1);
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

  it('records only fields whose allocation values actually changed', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({ ...allocationRow })),
        update: jest.fn(async () => ({ ...allocationRow, status: 'disabled' })),
      },
      environment: { count: jest.fn(async () => 0) },
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = makeService(prisma, 'admin', audit);

    await service.update('alloc-1', 'u1', {
      status: 'disabled',
      maxEnvironments: allocationRow.maxEnvironments,
    });

    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      actorUserId: 'u1',
      action: 'allocation.updated',
      resourceType: 'allocation',
      resourceId: 'alloc-1',
      resourceName: 'Company static host',
      details: { changedFields: 'status' },
    });
  });

  it('does not create an allocation audit event for a no-op update', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({ ...allocationRow })),
        update: jest.fn(async () => ({ ...allocationRow })),
      },
      environment: { count: jest.fn(async () => 0) },
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = makeService(prisma, 'admin', audit);

    await service.update('alloc-1', 'u1', { status: 'active' });

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('blocks allocation edits while a bound environment operation is active', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({ ...allocationRow })),
        update: jest.fn(),
      },
      environment: { count: jest.fn(async () => 1) },
    };
    const service = makeService(prisma, 'admin');

    await expect(service.update('alloc-1', 'u1', { status: 'disabled' }))
      .rejects.toThrow('deployment operation(s) in progress');
    expect(prisma.targetAllocation.update).not.toHaveBeenCalled();
  });

  it('keeps the allocation snapshot after a successful delete', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({ ...allocationRow })),
        delete: jest.fn(async () => allocationRow),
      },
      environment: { count: jest.fn(async () => 0) },
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = makeService(prisma, 'owner', audit);

    await service.remove('alloc-1', 'u1');

    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      actorUserId: 'u1',
      action: 'allocation.deleted',
      resourceType: 'allocation',
      resourceId: 'alloc-1',
      resourceName: 'Company static host',
      details: { targetId: 'tgt-1' },
    });
  });
});
