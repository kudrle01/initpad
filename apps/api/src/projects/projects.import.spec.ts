import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

jest.mock('../common/secret', () => ({ decryptSecret: () => 'tok', encryptSecret: (v: string) => v }));

// Constructor order: prisma, templates, generator, deployment, targets, scm, workspaces.
function build(parts: { prisma?: unknown; templates?: unknown; targets?: unknown; scm?: unknown; workspaces?: unknown }) {
  return new ProjectsService(
    parts.prisma as never,
    parts.templates as never,
    {} as never,
    {} as never,
    parts.targets as never,
    parts.scm as never,
    parts.workspaces as never,
  );
}

const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'owner') };

describe('ProjectsService.importExisting guards', () => {
  it('rejects a repository name that is not a valid project name', async () => {
    const service = build({ workspaces, prisma: { project: { findFirst: jest.fn() } } });
    await expect(service.importExisting({ repo: 'NotValid', templateId: 'node-api' }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a name already used in the workspace', async () => {
    const prisma = { project: { findFirst: jest.fn(async () => ({ id: 'p1' })) } };
    const service = build({ workspaces, prisma });
    await expect(service.importExisting({ repo: 'api', templateId: 'node-api' }, 'u1'))
      .rejects.toThrow('already has a project');
  });

  it('refuses to import an empty repository', async () => {
    const prisma = {
      project: { findFirst: jest.fn(async () => null) },
      user: { findUniqueOrThrow: jest.fn(async () => ({ id: 'u1', username: 'kudrla', accessToken: 'enc' })) },
    };
    const templates = { get: jest.fn(() => ({ id: 'node-api', name: 'Node API', runtime: 'node', artifact: 'runtime' })) };
    const scm = { listRepositories: jest.fn(async () => [{ name: 'api', empty: true, defaultBranch: 'main' }]) };
    const service = build({ workspaces, prisma, templates, scm });
    await expect(service.importExisting({ repo: 'api', templateId: 'node-api' }, 'u1'))
      .rejects.toThrow('empty');
  });
});
