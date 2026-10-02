import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService tenant isolation', () => {
  it('returns the production approval policy with workspace navigation data', async () => {
    const prisma = {
      workspaceMember: {
        findMany: jest.fn(async () => [
          {
            role: 'owner',
            workspace: {
              id: 'w1',
              slug: 'team',
              name: 'Team',
              type: 'team',
              productionApprovalPolicy: 'separate-reviewer',
              createdAt: new Date('2026-09-07T10:00:00.000Z'),
            },
          },
        ]),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);

    await expect(service.list('u1')).resolves.toEqual([
      expect.objectContaining({ productionApprovalPolicy: 'separate-reviewer' }),
    ]);
  });

  it('resolves only a workspace the user belongs to', async () => {
    const prisma = {
      workspaceMember: {
        findFirst: jest.fn(
          async ({ where }: { where: { userId: string; workspaceId?: string } }) =>
            where.userId === 'u1' && where.workspaceId === 'w1'
              ? { workspaceId: 'w1', userId: 'u1', role: 'member', createdAt: new Date() }
              : null,
        ),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    await expect(service.resolve('u1', 'w1')).resolves.toEqual({ id: 'w1', role: 'member' });
    await expect(service.resolve('u1', 'w2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a workspace outside the caller tenant as 404', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn(async () => null) },
    };
    const service = new WorkspacesService(prisma as never, {} as never);

    await expect(service.require('stranger', 'foreign-workspace', 'read')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('allows viewers to read but never write', async () => {
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'viewer' })),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    await expect(service.require('u1', 'w1', 'read')).resolves.toBe('viewer');
    await expect(service.require('u1', 'w1', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.require('u1', 'w1', 'admin')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets members deploy but reserves destructive maintenance for maintainers', async () => {
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'member' })),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    await expect(service.require('u1', 'w1', 'write')).resolves.toBe('member');
    await expect(service.require('u1', 'w1', 'maintain')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('authorizes a project through its workspace, not its SCM owner', async () => {
    const prisma = {
      project: { findUnique: jest.fn(async () => ({ workspaceId: 'team' })) },
      workspaceMember: {
        findUnique: jest.fn(async ({ where }: { where: { workspaceId_userId: unknown } }) =>
          where.workspaceId_userId ? { role: 'maintainer' } : null,
        ),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    await expect(service.requireProject('collaborator', 'project-1', 'write')).resolves.toEqual({
      workspaceId: 'team',
      role: 'maintainer',
    });
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'team', userId: 'collaborator' } },
    });
  });

  it('does not reveal a missing project as an authorization failure', async () => {
    const service = new WorkspacesService(
      { project: { findUnique: jest.fn(async () => null) } } as never,
      {} as never,
    );
    await expect(service.requireProject('u1', 'missing', 'read')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('hides a project in another workspace as 404', async () => {
    const prisma = {
      project: { findUnique: jest.fn(async () => ({ workspaceId: 'foreign-workspace' })) },
      workspaceMember: { findUnique: jest.fn(async () => null) },
    };
    const service = new WorkspacesService(prisma as never, {} as never);

    await expect(
      service.requireProject('stranger', 'foreign-project', 'read'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 403 when a workspace member lacks the requested project permission', async () => {
    const prisma = {
      project: { findUnique: jest.fn(async () => ({ workspaceId: 'team' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ role: 'viewer' })) },
    };
    const service = new WorkspacesService(prisma as never, {} as never);

    await expect(service.requireProject('viewer', 'project-1', 'write')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('grants repository access when an admin adds a member', async () => {
    const prisma = {
      user: { findFirst: jest.fn(async () => ({ id: 'u2', username: 'bob' })) },
      workspace: {
        findUnique: jest.fn(async () => ({ type: 'team', maxMembers: 100 })),
      },
      workspaceMember: {
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => 1),
        create: jest.fn(async () => ({})),
        delete: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      project: {
        findMany: jest.fn(async () => [
          {
            repoUrl: 'https://git.example/alice/app',
            scmProvider: 'gitea',
            scmRepositoryId: '101',
            scmOwner: 'alice',
            scmRepositoryName: 'app',
            scmFullName: 'alice/app',
            scmDefaultBranch: 'main',
            scmInstallationId: null,
          },
        ]),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (run: (client: typeof prisma) => unknown) =>
      run(prisma),
    );
    const gitea = { setCollaborator: jest.fn(async () => undefined) };
    const workspaceScm = {
      collaboratorUsername: jest.fn(async () => 'bob'),
      provider: jest.fn(() => gitea),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new WorkspacesService(prisma as never, workspaceScm as never, audit as never);
    jest.spyOn(service, 'require').mockResolvedValue('admin');

    await service.addMember('admin', 'team', { identity: ' BoB ', role: 'viewer' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { username: { equals: 'bob', mode: 'insensitive' } },
          { email: { equals: 'bob', mode: 'insensitive' } },
        ],
      },
    });

    expect(gitea.setCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gitea',
        repositoryId: '101',
        owner: 'alice',
        name: 'app',
      }),
      'bob',
      'viewer',
    );
    expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: 'team', userId: 'u2', role: 'viewer' },
    });
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'team',
      actorUserId: 'admin',
      action: 'workspace.member_added',
      resourceType: 'member',
      resourceId: 'u2',
      resourceName: 'bob',
      details: { role: 'viewer' },
    });
  });

  it('keeps personal workspaces private', async () => {
    const prisma = {
      workspace: { findUnique: jest.fn(async () => ({ type: 'personal' })) },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    jest.spyOn(service, 'require').mockResolvedValue('owner');

    await expect(
      service.addMember('owner', 'personal', { identity: 'bob', role: 'member' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets the team owner change production review policy and audits only the policy names', async () => {
    const previous = {
      id: 'team',
      name: 'Team',
      slug: 'team',
      type: 'team',
      productionApprovalPolicy: 'separate-reviewer',
      createdAt: new Date('2026-09-07T10:00:00.000Z'),
    };
    const prisma = {
      workspace: {
        findUnique: jest.fn(async () => previous),
        update: jest.fn(async () => ({ ...previous, productionApprovalPolicy: 'self-review' })),
      },
      workspaceMember: {
        findUniqueOrThrow: jest.fn(async () => ({ role: 'owner' })),
      },
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new WorkspacesService(prisma as never, {} as never, audit);
    jest.spyOn(service, 'require').mockResolvedValue('owner');

    await expect(
      service.updateProductionApprovalPolicy('owner', 'team', 'self-review'),
    ).resolves.toMatchObject({ productionApprovalPolicy: 'self-review', role: 'owner' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'owner',
        action: 'workspace.production_policy_changed',
        details: {
          previousPolicy: 'separate-reviewer',
          policy: 'self-review',
        },
      }),
    );
  });

  it.each(['admin', 'maintainer', 'member'] as const)(
    'does not let a team %s change production review policy',
    async (role) => {
      const prisma = {
        workspace: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      };
      const service = new WorkspacesService(prisma as never, {} as never);
      jest.spyOn(service, 'require').mockResolvedValue(role);

      await expect(
        service.updateProductionApprovalPolicy(role, 'team', 'self-review'),
      ).rejects.toThrow('Only the workspace owner can change the production approval policy');
      expect(service.require).toHaveBeenCalledWith(role, 'team', 'read');
      expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    },
  );

  it('keeps the workspace hidden when a non-member tries to change production policy', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn(async () => null) },
      workspace: { findUnique: jest.fn(), update: jest.fn() },
    };
    const service = new WorkspacesService(prisma as never, {} as never);

    await expect(
      service.updateProductionApprovalPolicy('stranger', 'team', 'self-review'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('does not allow changing the fixed self-review policy of a personal workspace', async () => {
    const prisma = {
      workspace: {
        findUnique: jest.fn(async () => ({
          type: 'personal',
          productionApprovalPolicy: 'self-review',
        })),
        update: jest.fn(),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    jest.spyOn(service, 'require').mockResolvedValue('owner');

    await expect(
      service.updateProductionApprovalPolicy('owner', 'personal', 'separate-reviewer'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });
});
