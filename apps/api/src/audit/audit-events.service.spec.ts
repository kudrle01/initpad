import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditEventsService } from './audit-events.service';

const at = (minute: number) => new Date(`2026-09-01T12:${String(minute).padStart(2, '0')}:00.000Z`);

function row(id: string, minute: number) {
  return {
    id,
    workspaceId: 'workspace-1',
    actorUserId: 'user-1',
    actorUsername: 'alice',
    actorDisplayName: 'Alice',
    action: 'workspace.member_added',
    outcome: 'succeeded',
    resourceType: 'member',
    resourceId: `member-${id}`,
    resourceName: `user-${id}`,
    operationType: null,
    operationId: null,
    details: { role: 'member' },
    createdAt: at(minute),
  };
}

describe('AuditEventsService', () => {
  it('stores immutable actor and resource snapshots with bounded safe details', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ username: 'alice', name: 'Alice' })) },
      auditEvent: { create: jest.fn(async () => ({})) },
    };
    const service = new AuditEventsService(prisma as never);

    await service.record({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'workspace.member_added',
      resourceType: 'member',
      resourceId: 'user-2',
      resourceName: 'bob',
      details: { role: 'maintainer' },
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
        actorUsername: 'alice',
        actorDisplayName: 'Alice',
        action: 'workspace.member_added',
        outcome: 'succeeded',
        resourceType: 'member',
        resourceId: 'user-2',
        resourceName: 'bob',
        operationType: null,
        operationId: null,
        details: { role: 'maintainer' },
      },
    });
  });

  it('does not label a named user without a profile display name as the system', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ username: 'alice', name: null })) },
      auditEvent: { create: jest.fn(async () => ({})) },
    };
    const service = new AuditEventsService(prisma as never);

    await service.record({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'workspace.metrics_exported',
      resourceType: 'workspace',
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        actorUsername: 'alice',
        actorDisplayName: null,
      }),
    });
  });

  it('preserves a null human display name in the terminal operation snapshot', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const create = jest.fn(async () => ({}));
    const prisma = {
      auditEvent: {
        findFirst: jest.fn(async () => ({
          actorUserId: 'user-1', actorUsername: 'alice', actorDisplayName: null,
        })),
        create,
      },
      deploymentOperation: {
        findUnique: jest.fn(async () => ({
          id: operationId,
          kind: 'deploy',
          status: 'succeeded',
          environment: {
            name: 'dev',
            project: { id: 'project-1', name: 'api', workspaceId: 'workspace-1' },
          },
        })),
      },
    };

    await new AuditEventsService(prisma as never).recordOperationResult('deployment', operationId);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        actorUsername: 'alice',
        actorDisplayName: null,
      }),
    });
  });

  it('records accepted and terminal operation events without copying runtime messages', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const create = jest.fn(async () => ({}));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ username: 'alice', name: 'Alice' })) },
      auditEvent: {
        create,
        findFirst: jest.fn(async () => ({
          actorUserId: 'user-1',
          actorUsername: 'alice',
          actorDisplayName: 'Alice',
        })),
      },
      deploymentOperation: {
        findUnique: jest.fn(async () => ({
          id: operationId,
          kind: 'promote',
          status: 'failed',
          message: 'sensitive provider output',
          environment: {
            name: 'test',
            project: { id: 'project-1', name: 'api', workspaceId: 'workspace-1' },
          },
        })),
      },
    };
    const service = new AuditEventsService(prisma as never);

    await service.record({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'environment.promotion_requested',
      outcome: 'accepted',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'api',
      operation: { type: 'deployment', id: operationId },
      details: { environment: 'test', kind: 'promote' },
    });
    await service.recordOperationResult('deployment', operationId);

    expect(create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        action: 'environment.promotion_requested',
        outcome: 'accepted',
        operationType: 'deployment',
        operationId,
      }),
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        actorUserId: 'user-1',
        action: 'environment.promotion_completed',
        outcome: 'failed',
        operationType: 'deployment',
        operationId,
        details: { environment: 'test', kind: 'promote' },
      }),
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain('sensitive provider output');
  });

  it('enriches audit rows from the authoritative operation instead of copied status', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const operationRow = {
      ...row('3', 3),
      operationType: 'deployment',
      operationId,
    };
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn(async () => ({ workspaceId: 'workspace-1' })),
      },
      auditEvent: { findMany: jest.fn(async () => [operationRow]) },
      deploymentOperation: {
        findMany: jest.fn(async () => [{
          id: operationId,
          kind: 'deploy',
          status: 'succeeded',
          phase: 'succeeded',
          environment: { projectId: 'project-1' },
        }]),
      },
      provisioningOperation: { findMany: jest.fn() },
    };

    const page = await new AuditEventsService(prisma as never).list(
      'user-1',
      'workspace-1',
      { limit: 30 },
    );

    expect(page.items[0].operation).toEqual({
      type: 'deployment',
      id: operationId,
      kind: 'deploy',
      status: 'succeeded',
      phase: 'succeeded',
      projectId: 'project-1',
    });
  });

  it('treats a replayed terminal callback as idempotent', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const prisma = {
      auditEvent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => {
          throw { code: 'P2002' };
        }),
      },
      provisioningOperation: {
        findUnique: jest.fn(async () => ({
          id: operationId,
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          projectName: 'api',
          kind: 'create',
          status: 'succeeded',
          attempt: 1,
        })),
      },
    };

    await expect(
      new AuditEventsService(prisma as never).recordOperationResult(
        'provisioning',
        operationId,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects detail fields that could persist secrets or logs', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ username: 'alice', name: null })) },
      auditEvent: { create: jest.fn(async () => ({})) },
    };
    const service = new AuditEventsService(prisma as never);

    await expect(service.record({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'target.created',
      resourceType: 'target',
      details: { password: 'never-store-this' },
    })).rejects.toThrow("Unsafe audit detail key 'password'");
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns a stable filtered cursor page newest first', async () => {
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn(async () => ({ workspaceId: 'workspace-1' })),
      },
      auditEvent: {
        findFirst: jest.fn(async () => ({ id: 'cursor-1' })),
        findMany: jest.fn(async () => [row('3', 3), row('2', 2), row('1', 1)]),
      },
    };
    const service = new AuditEventsService(prisma as never);

    const page = await service.list('user-1', 'workspace-1', {
      limit: 2,
      cursor: 'cursor-1',
      action: 'workspace.member_added',
      resourceType: 'member',
      outcome: 'succeeded',
    });

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        action: 'workspace.member_added',
        resourceType: 'member',
        outcome: 'succeeded',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      cursor: { id: 'cursor-1' },
      skip: 1,
    });
    expect(page.items.map((event) => event.id)).toEqual(['3', '2']);
    expect(page.nextCursor).toBe('2');
    expect(page.items[0]).toEqual(expect.objectContaining({
      actor: { userId: 'user-1', username: 'alice', displayName: 'Alice' },
      resource: { type: 'member', id: 'member-3', name: 'user-3' },
      createdAt: '2026-09-01T12:03:00.000Z',
    }));
  });

  it('hides a foreign workspace as 404 before reading any event', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn(async () => null) },
      auditEvent: { findMany: jest.fn() },
    };
    const service = new AuditEventsService(prisma as never);

    await expect(service.list('user-1', 'foreign', { limit: 30 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects a cursor outside the selected workspace', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn(async () => ({ workspaceId: 'workspace-1' })) },
      auditEvent: { findFirst: jest.fn(async () => null), findMany: jest.fn() },
    };
    const service = new AuditEventsService(prisma as never);

    await expect(service.list('user-1', 'workspace-1', {
      limit: 30,
      cursor: 'c529f180-040f-4c4a-8c46-8c488df8468f',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });
});
