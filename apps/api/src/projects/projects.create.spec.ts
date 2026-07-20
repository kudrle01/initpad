import { ProjectsService } from './projects.service';

const repository = {
  provider: 'gitea' as const,
  repositoryId: '101',
  owner: 'alice',
  name: 'new-api',
  fullName: 'alice/new-api',
  defaultBranch: 'main',
  repoUrl: 'https://git.test/alice/new-api',
  installationId: null,
};

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

function build(completeEffect: jest.Mock = jest.fn(async () => undefined)) {
  const prisma = {
    project: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'p1' })),
      delete: jest.fn(async () => undefined),
    },
    user: { findUniqueOrThrow: jest.fn(async () => ({ id: 'u1', username: 'alice' })) },
    workspaceMember: { findMany: jest.fn(async () => []) },
  };
  const scm = {
    initLocal: jest.fn(async () => undefined),
    provision: jest.fn(async () => repository),
    deleteRepo: jest.fn(async () => undefined),
  };
  const provisioning = {
    start: jest.fn(async () => 'op1'),
    planEffect: jest.fn(async () => undefined),
    beginEffect: jest.fn(async () => undefined),
    completeEffect,
    failEffect: jest.fn(async () => undefined),
    compensateEffect: jest.fn(async () => undefined),
    compensationFailed: jest.fn(async () => undefined),
    bindProject: jest.fn(async () => undefined),
    succeed: jest.fn(async () => undefined),
    fail: jest.fn(async () => undefined),
  };
  const service = new ProjectsService(
    prisma as never,
    { get: jest.fn(() => template) } as never,
    { generate: jest.fn(() => ({ repoPath: '/tmp/initpad-create-journal-test' })) } as never,
    {} as never,
    { listEntities: jest.fn(async () => [dockerTarget]), parseCaps: (v: string) => v.split(',') } as never,
    {
      createContext: jest.fn(async () => ({
        kind: 'gitea', actor: { username: 'alice', token: 'token' },
        target: { userId: 'u1', installationId: '' },
      })),
      provider: jest.fn(() => scm),
    } as never,
    {
      resolve: jest.fn(async () => ({ id: 'ws1' })),
      require: jest.fn(async () => 'owner'),
    } as never,
    provisioning as never,
  );
  jest.spyOn(service, 'get').mockResolvedValue({ id: 'p1' } as never);
  return { service, prisma, scm, provisioning };
}

describe('ProjectsService create provisioning journal', () => {
  it('records repository and project effects before reporting success', async () => {
    const { service, provisioning } = build();
    await expect(
      service.create({ name: 'new-api', templateId: 'node-api' }, 'u1'),
    ).resolves.toMatchObject({ id: 'p1' });
    expect(provisioning.planEffect).toHaveBeenCalledWith(
      'op1', 'repository:create', 'repository', expect.anything(),
    );
    expect(provisioning.planEffect).toHaveBeenCalledWith(
      'op1', 'project:record', 'project', expect.anything(),
    );
    expect(provisioning.succeed).toHaveBeenCalledWith('op1', 'p1');
  });

  it('deletes a created repository when persisting its applied result fails', async () => {
    const completeEffect = jest.fn(async () => { throw new Error('journal unavailable'); });
    const { service, scm, provisioning } = build(completeEffect);
    await expect(
      service.create({ name: 'new-api', templateId: 'node-api' }, 'u1'),
    ).rejects.toThrow('journal unavailable');
    expect(scm.deleteRepo).toHaveBeenCalledWith(
      repository,
      expect.objectContaining({ username: 'alice' }),
    );
    expect(provisioning.compensateEffect).toHaveBeenCalledWith('op1', 'repository:create');
    expect(provisioning.fail).toHaveBeenCalledWith('op1', expect.stringContaining('journal unavailable'));
  });
});
