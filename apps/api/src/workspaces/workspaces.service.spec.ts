import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService tenant isolation', () => {
  it('resolves only a workspace the user belongs to', async () => {
    const prisma = {
      workspaceMember: {
        findFirst: jest.fn(async ({ where }: { where: { userId: string; workspaceId?: string } }) =>
          where.userId === 'u1' && where.workspaceId === 'w1'
            ? { workspaceId: 'w1', userId: 'u1', role: 'member', createdAt: new Date() }
            : null,
        ),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never);
    await expect(service.resolve('u1', 'w1')).resolves.toEqual({ id: 'w1', role: 'member' });
    await expect(service.resolve('u1', 'w2')).rejects.toBeInstanceOf(ForbiddenException);
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
    await expect(service.require('u1', 'w1', 'maintain')).rejects.toBeInstanceOf(ForbiddenException);
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
    const service = new WorkspacesService({ project: { findUnique: jest.fn(async () => null) } } as never, {} as never);
    await expect(service.requireProject('u1', 'missing', 'read')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a project in another workspace as 404', async () => {
    const prisma = {
      project: { findUnique: jest.fn(async () => ({ workspaceId: 'foreign-workspace' })) },
      workspaceMember: { findUnique: jest.fn(async () => null) },
    };
    const service = new WorkspacesService(prisma as never, {} as never);

    await expect(service.requireProject('stranger', 'foreign-project', 'read')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
      workspace: { findUnique: jest.fn(async () => ({ type: 'team' })) },
      workspaceMember: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        delete: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      project: {
        findMany: jest.fn(async () => [{
          repoUrl: 'https://git.example/alice/app',
          scmProvider: 'gitea',
          scmRepositoryId: '101',
          scmOwner: 'alice',
          scmRepositoryName: 'app',
          scmFullName: 'alice/app',
          scmDefaultBranch: 'main',
          scmInstallationId: null,
        }]),
      },
    };
    const gitea = { setCollaborator: jest.fn(async () => undefined) };
    const workspaceScm = {
      collaboratorUsername: jest.fn(async () => 'bob'),
      provider: jest.fn(() => gitea),
    };
    const service = new WorkspacesService(prisma as never, workspaceScm as never);
    jest.spyOn(service, 'require').mockResolvedValue('admin');

    await service.addMember('admin', 'team', { identity: 'bob', role: 'viewer' });

    expect(gitea.setCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gitea', repositoryId: '101', owner: 'alice', name: 'app',
      }),
      'bob',
      'viewer',
    );
    expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: 'team', userId: 'u2', role: 'viewer' },
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
});
