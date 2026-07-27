import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

jest.mock('../common/secret', () => ({ decryptSecret: () => 'tok', encryptSecret: (v: string) => v }));

const provisioning = {
  start: jest.fn(async () => 'op1'),
  step: jest.fn(async () => undefined),
  bindProject: jest.fn(async () => undefined),
  unbindProject: jest.fn(async () => undefined),
  planEffect: jest.fn(async () => undefined),
  beginEffect: jest.fn(async () => undefined),
  completeEffect: jest.fn(async () => undefined),
  failEffect: jest.fn(async () => undefined),
  compensateEffect: jest.fn(async () => undefined),
  compensationFailed: jest.fn(async () => undefined),
  succeed: jest.fn(async () => undefined),
  fail: jest.fn(async () => undefined),
};

// Constructor order: prisma, templates, generator, deployment, targets, scm, workspaces, provisioning.
function build(parts: { prisma?: unknown; templates?: unknown; targets?: unknown; scm?: unknown; workspaces?: unknown }) {
  const scm = parts.scm as { listRepositories?: () => Promise<ReturnType<typeof repository>[]> };
  const prisma = {
    targetAllocation: {
      findUnique: jest.fn(async () => ({
        id: 'allocation-builtin-docker',
        targetId: 'builtin-docker',
        namespace: 'workspace',
        rootPath: null,
        publicUrl: null,
        capabilities: 'static,node,php,python',
        status: 'active',
        maxEnvironments: 50,
      })),
      create: jest.fn(),
    },
    environment: { count: jest.fn(async () => 0) },
    ...(parts.prisma as object),
  };
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
    prisma as never,
    parts.templates as never,
    {} as never,
    {} as never,
    parts.targets as never,
    workspaceScm as never,
    parts.workspaces as never,
    provisioning as never,
    {} as never,
  );
}

const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'owner') };
const owner = { id: 'u1', username: 'kudrla', accessToken: 'enc' };
const template = {
  id: 'node-api', name: 'Node API', language: 'TypeScript', runtime: 'node',
  artifact: 'runtime', compatibleProviders: ['docker', 'ssh'], description: 'test',
};
const dockerTarget = {
  id: 'builtin-docker', name: 'Docker', kind: 'docker', scope: 'builtin',
  capabilities: 'static,node,php,python', host: null, port: null, username: null,
  auth: null, secret: null, remotePath: null, publicUrl: null, verifiedAt: null,
  ownerId: null, workspaceId: null, createdAt: new Date(),
};
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
  beforeEach(() => jest.clearAllMocks());

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

  it('removes partial secrets and the project record when repository setup fails', async () => {
    const prisma = {
      project: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'p1' })),
        delete: jest.fn(async () => undefined),
      },
      user: {
        findUniqueOrThrow: jest.fn(async () => owner),
        update: jest.fn(async () => owner),
      },
      workspaceMember: { findMany: jest.fn(async () => []) },
    };
    const scm = {
      listRepositories: jest.fn(async () => [repository()]),
      readFile: jest.fn(async (_repo: unknown, path: string) =>
        path === 'Dockerfile' ? 'FROM node:22' : 'INITPAD_PLATFORM_URL INITPAD_DEPLOY_TOKEN'),
      issueCloneToken: jest.fn(async () => 'clone-token'),
      configureRepoSecrets: jest.fn(async () => { throw new Error('secret write failed'); }),
      removeRepoSecrets: jest.fn(async () => undefined),
    };
    const service = build({
      workspaces,
      prisma,
      templates: { get: jest.fn(() => template) },
      targets: { listEntities: jest.fn(async () => [dockerTarget]), parseCaps: (v: string) => v.split(',') },
      scm,
    });

    await expect(
      service.importExisting({ repositoryId: '101', templateId: 'node-api' }, 'u1'),
    ).rejects.toThrow('All InitPad changes were rolled back');
    expect(scm.removeRepoSecrets).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'kudrla/api' }));
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(provisioning.compensateEffect).toHaveBeenCalledWith('op1', 'secrets:initpad');
    expect(provisioning.compensateEffect).toHaveBeenCalledWith('op1', 'project:record');
  });

  it('keeps the project visible when external compensation itself fails', async () => {
    const prisma = {
      project: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'p1' })),
        delete: jest.fn(async () => undefined),
      },
      user: {
        findUniqueOrThrow: jest.fn(async () => owner),
        update: jest.fn(async () => owner),
      },
      workspaceMember: { findMany: jest.fn(async () => []) },
    };
    const scm = {
      listRepositories: jest.fn(async () => [repository()]),
      readFile: jest.fn(async (_repo: unknown, path: string) =>
        path === 'Dockerfile' ? 'FROM node:22' : 'INITPAD_PLATFORM_URL INITPAD_DEPLOY_TOKEN'),
      issueCloneToken: jest.fn(async () => 'clone-token'),
      configureRepoSecrets: jest.fn(async () => { throw new Error('secret write failed'); }),
      removeRepoSecrets: jest.fn(async () => { throw new Error('GitHub unavailable'); }),
    };
    const service = build({
      workspaces,
      prisma,
      templates: { get: jest.fn(() => template) },
      targets: { listEntities: jest.fn(async () => [dockerTarget]), parseCaps: (v: string) => v.split(',') },
      scm,
    });

    await expect(
      service.importExisting({ repositoryId: '101', templateId: 'node-api' }, 'u1'),
    ).rejects.toThrow("was kept so an owner can inspect and repair it");
    expect(prisma.project.delete).not.toHaveBeenCalled();
    expect(provisioning.compensationFailed).toHaveBeenCalledWith(
      'op1', 'secrets:initpad', 'GitHub unavailable',
    );
  });
});
