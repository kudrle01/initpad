import { ProjectsService } from './projects.service';
import type { TargetRow } from '../targets/targets.service';
import { config } from '../config';

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
  id: 'node-api',
  name: 'Node API',
  language: 'TypeScript',
  runtime: 'node',
  artifact: 'runtime',
  compatibleProviders: ['docker', 'ssh'],
  description: 'test',
};

const dockerTarget: TargetRow = {
  id: 'builtin-docker',
  name: 'Docker',
  kind: 'docker',
  scope: 'builtin',
  capabilities: 'static,node,php,python',
  host: null,
  port: null,
  username: null,
  auth: null,
  secret: null,
  remotePath: null,
  publicUrl: null,
  verifiedAt: null,
  ownerId: null,
  workspaceId: null,
  createdAt: new Date(),
};

function build(
  completeEffect: jest.Mock = jest.fn(async () => undefined),
  options?: {
    selectedTemplate?: typeof template;
    targets?: TargetRow[];
    allocation?: {
      id: string;
      targetId: string;
      namespace: string;
      rootPath: string | null;
      publicUrl: string | null;
      capabilities: string;
      status: string;
      maxEnvironments: number;
    };
    allocatedEnvironments?: number;
  },
) {
  const prisma = {
    project: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (_input: unknown) => ({ id: 'p1' })),
      delete: jest.fn(async () => undefined),
    },
    targetAllocation: {
      findUnique: jest.fn(
        async (input: { where: { workspaceId_targetId?: { targetId: string } } }) => {
          const targetId = input.where.workspaceId_targetId?.targetId ?? 'builtin-docker';
          return (
            options?.allocation ?? {
              id: `allocation-${targetId}`,
              targetId,
              namespace: 'workspace',
              rootPath: null,
              publicUrl: null,
              capabilities: 'static,node,php,python',
              status: 'active',
              maxEnvironments: 50,
            }
          );
        },
      ),
      create: jest.fn(),
    },
    environment: {
      count: jest.fn(async () => options?.allocatedEnvironments ?? 0),
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
    unbindProject: jest.fn(async () => undefined),
    succeed: jest.fn(async () => undefined),
    fail: jest.fn(async () => undefined),
  };
  const service = new ProjectsService(
    prisma as never,
    { get: jest.fn(() => options?.selectedTemplate ?? template) } as never,
    { generate: jest.fn(() => ({ repoPath: '/tmp/initpad-create-journal-test' })) } as never,
    {} as never,
    {
      listEntities: jest.fn(async () => options?.targets ?? [dockerTarget]),
      parseCaps: (v: string) => v.split(','),
    } as never,
    {
      createContext: jest.fn(async () => ({
        kind: 'gitea',
        actor: { username: 'alice', token: 'token' },
        target: { userId: 'u1', installationId: '' },
      })),
      provider: jest.fn(() => scm),
    } as never,
    {
      resolve: jest.fn(async () => ({ id: 'ws1' })),
      require: jest.fn(async () => 'owner'),
    } as never,
    provisioning as never,
    {} as never,
  );
  jest.spyOn(service, 'get').mockResolvedValue({ id: 'p1' } as never);
  return { service, prisma, scm, provisioning };
}

describe('ProjectsService create provisioning journal', () => {
  const savedEdition = config.edition;
  const savedCiPublicUrl = config.ci.publicUrl;

  beforeEach(() => {
    config.edition = 'self-hosted';
  });

  afterEach(() => {
    config.edition = savedEdition;
    config.ci.publicUrl = savedCiPublicUrl;
  });

  it('records repository and project effects before reporting success', async () => {
    const { service, provisioning } = build();
    await expect(
      service.create({ name: 'new-api', templateId: 'node-api' }, 'u1'),
    ).resolves.toMatchObject({ id: 'p1' });
    expect(provisioning.planEffect).toHaveBeenCalledWith(
      'op1',
      'repository:create',
      'repository',
      expect.anything(),
    );
    expect(provisioning.planEffect).toHaveBeenCalledWith(
      'op1',
      'project:record',
      'project',
      expect.anything(),
    );
    expect(provisioning.succeed).toHaveBeenCalledWith('op1', 'p1');
  });

  it('uses Docker instead of the deprecated SSH runtime for new Node environments', async () => {
    const builtinSsh: TargetRow = {
      ...dockerTarget,
      id: 'builtin-ssh',
      name: 'Legacy SSH',
      kind: 'ssh',
      capabilities: 'node',
      host: 'fake-vps',
      port: 22,
      username: 'deploy',
      remotePath: '/srv/apps',
    };
    const { service, prisma } = build(
      jest.fn(async () => undefined),
      {
        targets: [dockerTarget, builtinSsh],
      },
    );

    await service.create({ name: 'new-api', templateId: 'node-api' }, 'u1');

    const createInput = prisma.project.create.mock.calls[0]?.[0] as {
      data: { environments: { create: Array<{ provider: string; targetId: string }> } };
    };
    expect(createInput.data.environments.create).toHaveLength(3);
    expect(createInput.data.environments.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'docker', targetId: 'builtin-docker' }),
      ]),
    );
    expect(createInput.data.environments.create).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ targetId: 'builtin-ssh' })]),
    );
  });

  it('deletes a created repository when persisting its applied result fails', async () => {
    const completeEffect = jest.fn(async () => {
      throw new Error('journal unavailable');
    });
    const { service, scm, provisioning } = build(completeEffect);
    await expect(service.create({ name: 'new-api', templateId: 'node-api' }, 'u1')).rejects.toThrow(
      'journal unavailable',
    );
    expect(scm.deleteRepo).toHaveBeenCalledWith(
      repository,
      expect.objectContaining({ username: 'alice' }),
    );
    expect(provisioning.compensateEffect).toHaveBeenCalledWith('op1', 'repository:create');
    expect(provisioning.fail).toHaveBeenCalledWith(
      'op1',
      expect.stringContaining('journal unavailable'),
    );
  });

  it('binds PHP production to a verified workspace SFTP host by default', async () => {
    const phpTemplate = {
      ...template,
      id: 'nette',
      runtime: 'php',
      compatibleProviders: ['docker', 'sftp'],
    };
    const phpSftpTarget = {
      ...dockerTarget,
      id: 'eso',
      name: 'ESO',
      kind: 'sftp',
      scope: 'user',
      capabilities: 'static,php',
      verifiedAt: new Date(),
      workspaceId: 'ws1',
    };
    const { service, prisma } = build(
      jest.fn(async () => undefined),
      {
        selectedTemplate: phpTemplate,
        targets: [dockerTarget, phpSftpTarget],
      },
    );

    await service.create({ name: 'new-api', templateId: 'nette' }, 'u1');

    const createInput = prisma.project.create.mock.calls[0]?.[0] as
      | {
          data: {
            environments: { create: Array<{ name: string; provider: string; targetId: string }> };
          };
        }
      | undefined;
    expect(createInput).toBeDefined();
    const environments = createInput!.data.environments.create;
    expect(
      environments.find((environment: { name: string }) => environment.name === 'prod'),
    ).toMatchObject({
      provider: 'sftp',
      targetId: 'eso',
      allocationId: 'allocation-eso',
    });
  });

  it('does not implicitly bind PHP production to an unverified workspace host', async () => {
    const phpTemplate = {
      ...template,
      id: 'nette',
      runtime: 'php',
      compatibleProviders: ['docker', 'sftp'],
    };
    const unverifiedSftpTarget: TargetRow = {
      ...dockerTarget,
      id: 'eso',
      name: 'ESO',
      kind: 'sftp',
      scope: 'user',
      capabilities: 'static,php',
      workspaceId: 'ws1',
    };
    const { service, prisma } = build(
      jest.fn(async () => undefined),
      {
        selectedTemplate: phpTemplate,
        targets: [dockerTarget, unverifiedSftpTarget],
      },
    );

    await service.create({ name: 'new-api', templateId: 'nette' }, 'u1');

    const createInput = prisma.project.create.mock.calls[0]?.[0] as {
      data: {
        environments: { create: Array<{ name: string; provider: string; targetId: string }> };
      };
    };
    expect(
      createInput.data.environments.create.find((environment) => environment.name === 'prod'),
    ).toMatchObject({ provider: 'docker', targetId: 'builtin-docker' });
  });

  it('rejects SaaS provisioning before repository creation when the callback is local', async () => {
    config.edition = 'saas';
    config.ci.publicUrl = 'http://localhost:8080';
    const { service, scm } = build();

    await expect(service.create({ name: 'new-api', templateId: 'node-api' }, 'u1')).rejects.toThrow(
      'GitHub CI callback',
    );
    expect(scm.provision).not.toHaveBeenCalled();
  });

  it('requires an explicit target for every SaaS environment', async () => {
    config.edition = 'saas';
    config.ci.publicUrl = 'https://initpad.example';
    const { service, scm } = build();

    await expect(service.create({ name: 'new-api', templateId: 'node-api' }, 'u1')).rejects.toThrow(
      'Choose a verified workspace target for the dev environment',
    );
    expect(scm.provision).not.toHaveBeenCalled();
  });

  it('rejects a legacy SSH target before repository creation', async () => {
    config.edition = 'saas';
    config.ci.publicUrl = 'https://initpad.example';
    const unverifiedSshTarget: TargetRow = {
      ...dockerTarget,
      id: 'workspace-ssh',
      name: 'Company server',
      kind: 'ssh',
      scope: 'user',
      capabilities: 'node',
      workspaceId: 'ws1',
    };
    const { service, scm } = build(
      jest.fn(async () => undefined),
      {
        targets: [unverifiedSshTarget],
      },
    );
    const environments = (['dev', 'test', 'prod'] as const).map((name) => ({
      name,
      targetId: unverifiedSshTarget.id,
    }));

    await expect(
      service.create({ name: 'new-api', templateId: 'node-api', environments }, 'u1'),
    ).rejects.toThrow('uses the legacy SSH runtime');
    expect(scm.provision).not.toHaveBeenCalled();
  });

  it('rejects a narrowed allocation before creating a repository', async () => {
    const { service, scm } = build(
      jest.fn(async () => undefined),
      {
        allocation: {
          id: 'allocation-builtin-docker',
          targetId: 'builtin-docker',
          namespace: 'workspace',
          rootPath: null,
          publicUrl: null,
          capabilities: 'static,php',
          status: 'active',
          maxEnvironments: 50,
        },
      },
    );

    await expect(service.create({ name: 'new-api', templateId: 'node-api' }, 'u1')).rejects.toThrow(
      'does not allow node',
    );
    expect(scm.provision).not.toHaveBeenCalled();
  });

  it('rejects insufficient allocation quota before creating a repository', async () => {
    const { service, scm } = build(
      jest.fn(async () => undefined),
      {
        allocation: {
          id: 'allocation-builtin-docker',
          targetId: 'builtin-docker',
          namespace: 'workspace',
          rootPath: null,
          publicUrl: null,
          capabilities: 'static,node,php,python',
          status: 'active',
          maxEnvironments: 4,
        },
        allocatedEnvironments: 2,
      },
    );

    await expect(service.create({ name: 'new-api', templateId: 'node-api' }, 'u1')).rejects.toThrow(
      'project needs 3',
    );
    expect(scm.provision).not.toHaveBeenCalled();
  });
});
