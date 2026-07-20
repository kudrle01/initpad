import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

jest.mock('../common/secret', () => ({ decryptSecret: () => 'tok', encryptSecret: (v: string) => v }));

const provisioning = {
  start: jest.fn(async () => 'op1'),
  step: jest.fn(async () => undefined),
  succeed: jest.fn(async () => undefined),
  fail: jest.fn(async () => undefined),
};

// Constructor order: prisma, templates, generator, deployment, targets, scm, workspaces, provisioning.
function build(parts: { prisma?: unknown; templates?: unknown; targets?: unknown; scm?: unknown; workspaces?: unknown }) {
  const scm = parts.scm as { listRepositories?: () => Promise<ReturnType<typeof repository>[]> };
  const workspaceScm = {
    repository: jest.fn(async (_userId: string, _workspaceId: string, repositoryId: string) => {
      const repo = (await scm.listRepositories?.())?.find((candidate) => candidate.repositoryId === repositoryId);
      if (!repo) throw new Error('not found');
      return { repo, actor: { username: owner.username, token: 'tok' } };
    }),
    provider: jest.fn(() => scm),
    collaboratorUsername: jest.fn(async () => owner.username),
  };
  return new ProjectsService(
    parts.prisma as never,
    parts.templates as never,
    {} as never,
    {} as never,
    parts.targets as never,
    workspaceScm as never,
    parts.workspaces as never,
    provisioning as never,
  );
}

const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'owner') };
const owner = { id: 'u1', username: 'kudrla', accessToken: 'enc' };
const template = { id: 'node-api', name: 'Node API', runtime: 'node', artifact: 'runtime' };
const repository = (name = 'api', empty = false) => ({
  provider: 'gitea',
  repositoryId: '101',
  owner: 'kudrla',
  name,
  fullName: `kudrla/${name}`,
  repoUrl: `https://git.test/kudrla/${name}`,
  installationId: null,
  private: true,
  defaultBranch: 'main',
  updatedAt: '',
  empty,
});

describe('ProjectsService.importExisting guards', () => {
  it('rejects a repository name that is not a valid project name', async () => {
    const service = build({
      workspaces,
      prisma: { user: { findUniqueOrThrow: jest.fn(async () => owner) } },
      templates: { get: jest.fn(() => template) },
      scm: { listRepositories: jest.fn(async () => [repository('NotValid')]) },
    });
    await expect(service.importExisting({ repositoryId: '101', templateId: 'node-api' }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a name already used in the workspace', async () => {
    const prisma = {
      project: { findFirst: jest.fn(async () => ({ id: 'p1' })) },
      user: { findUniqueOrThrow: jest.fn(async () => owner) },
    };
    const service = build({
      workspaces,
      prisma,
      templates: { get: jest.fn(() => template) },
      scm: { listRepositories: jest.fn(async () => [repository()]) },
    });
    await expect(service.importExisting({ repositoryId: '101', templateId: 'node-api' }, 'u1'))
      .rejects.toThrow('already has a project');
  });

  it('refuses to import an empty repository', async () => {
    const prisma = {
      project: { findFirst: jest.fn(async () => null) },
      user: { findUniqueOrThrow: jest.fn(async () => owner) },
    };
    const templates = { get: jest.fn(() => template) };
    const scm = { listRepositories: jest.fn(async () => [repository('api', true)]) };
    const service = build({ workspaces, prisma, templates, scm });
    await expect(service.importExisting({ repositoryId: '101', templateId: 'node-api' }, 'u1'))
      .rejects.toThrow('empty');
  });
});
