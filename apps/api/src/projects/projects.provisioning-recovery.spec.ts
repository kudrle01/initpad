import { ProjectsService } from './projects.service';

const project = {
  id: 'p1',
  scmProvider: 'github',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: 'installation-1',
  repoUrl: 'https://github.com/acme/api',
};

const effect = (key: string, kind: string, metadata: unknown = null) => ({
  key,
  kind,
  status: 'applied',
  metadata,
  error: null,
  createdAt: new Date(),
  appliedAt: new Date(),
  compensatedAt: null,
});

function build(operation: Record<string, unknown>, scmOverrides: Record<string, unknown> = {}) {
  const prisma = {
    project: {
      findUnique: jest.fn(async () => project),
      delete: jest.fn(async () => project),
    },
  };
  const scm = {
    restoreCollaboratorAccess: jest.fn(async () => undefined),
    removeRepoSecrets: jest.fn(async () => undefined),
    deleteRepo: jest.fn(async () => undefined),
    ...scmOverrides,
  };
  const provisioning = {
    record: jest.fn(async () => operation),
    isRetryable: jest.fn(() => true),
    needsCleanup: jest.fn(() => true),
    claimRetry: jest.fn(async () => undefined),
    releaseRetry: jest.fn(async () => undefined),
    compensateEffect: jest.fn(async () => undefined),
    compensationFailed: jest.fn(async () => undefined),
    claimCleanup: jest.fn(async () => undefined),
    releaseCleanup: jest.fn(async () => undefined),
    cleanupFinished: jest.fn(async () => undefined),
    unbindProject: jest.fn(async () => undefined),
  };
  const workspaceScm = {
    provider: jest.fn(() => scm),
    actorForRepository: jest.fn(async () => ({ username: 'alice', token: '' })),
  };
  const workspaces = { require: jest.fn(async () => 'owner') };
  const service = new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    workspaceScm as never,
    workspaces as never,
    provisioning as never,
    {} as never,
  );
  return { service, prisma, scm, provisioning, workspaceScm, workspaces };
}

describe('ProjectsService provisioning recovery', () => {
  it('claims a safe retry and starts a linked next attempt', async () => {
    const operation = {
      id: 'op1',
      workspaceId: 'ws1',
      projectId: null,
      projectName: 'api',
      kind: 'create',
      status: 'failed',
      requestedById: 'u1',
      request: { name: 'api', templateId: 'node-api' },
      retryOfId: null,
      attempt: 2,
      effects: [],
    };
    const { service, provisioning } = build(operation);
    const create = jest.spyOn(service, 'create').mockResolvedValue({ id: 'p2' } as never);
    await expect(service.retryProvisioning('op1', 'u1')).resolves.toMatchObject({ id: 'p2' });
    expect(provisioning.claimRetry).toHaveBeenCalledWith('op1');
    expect(create).toHaveBeenCalledWith(operation.request, 'u1', 'ws1', {
      retryOfId: 'op1',
      attempt: 3,
    });
  });

  it('restores import collaborators and secrets before deleting the recovery record', async () => {
    const operation = {
      id: 'op1',
      workspaceId: 'ws1',
      projectId: 'p1',
      projectName: 'api',
      kind: 'import',
      status: 'failed',
      requestedById: 'u1',
      request: {},
      retryOfId: null,
      attempt: 1,
      effects: [
        effect('project:record', 'project', { projectId: 'p1' }),
        effect('secrets:initpad', 'secrets'),
        effect('collaborator:u2', 'collaborator', { username: 'bob', previousAccess: 'pull' }),
      ],
    };
    const { service, prisma, scm, provisioning } = build(operation);
    await service.cleanupProvisioning('op1', 'u1');
    expect(scm.restoreCollaboratorAccess).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/api' }),
      'bob',
      'pull',
    );
    expect(scm.removeRepoSecrets).toHaveBeenCalled();
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(provisioning.compensateEffect).toHaveBeenCalledWith('op1', 'project:record');
    expect(provisioning.cleanupFinished).toHaveBeenCalledWith('op1');
  });

  it('keeps the project when idempotent cleanup cannot reach the provider', async () => {
    const operation = {
      id: 'op1',
      workspaceId: 'ws1',
      projectId: 'p1',
      projectName: 'api',
      kind: 'import',
      status: 'interrupted',
      requestedById: 'u1',
      request: {},
      retryOfId: null,
      attempt: 1,
      effects: [effect('project:record', 'project'), effect('secrets:initpad', 'secrets')],
    };
    const { service, prisma, provisioning } = build(operation, {
      removeRepoSecrets: jest.fn(async () => {
        throw new Error('provider offline');
      }),
    });
    await expect(service.cleanupProvisioning('op1', 'u1')).rejects.toThrow('provider offline');
    expect(prisma.project.delete).not.toHaveBeenCalled();
    expect(provisioning.compensationFailed).toHaveBeenCalledWith(
      'op1',
      'secrets:initpad',
      'provider offline',
    );
  });

  it('can remove an orphaned newly-created repository from journal metadata', async () => {
    const operation = {
      id: 'op1',
      workspaceId: 'ws1',
      projectId: null,
      projectName: 'api',
      kind: 'create',
      status: 'interrupted',
      requestedById: 'u1',
      request: {},
      retryOfId: null,
      attempt: 1,
      effects: [
        effect('repository:create', 'repository', {
          provider: 'github',
          repositoryId: '101',
          owner: 'acme',
          name: 'api',
          fullName: 'acme/api',
          defaultBranch: 'main',
          repoUrl: 'https://github.com/acme/api',
          installationId: 'installation-1',
        }),
      ],
    };
    const { service, scm, provisioning } = build(operation);
    await service.cleanupProvisioning('op1', 'u1');
    expect(scm.deleteRepo).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: '101', installationId: 'installation-1' }),
      expect.anything(),
    );
    expect(provisioning.compensateEffect).toHaveBeenCalledWith('op1', 'repository:create');
  });
});
