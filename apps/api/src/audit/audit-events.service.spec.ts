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
        details: { role: 'maintainer' },
      },
    });
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
