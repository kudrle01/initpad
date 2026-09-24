import { ProjectDeploymentExecutor } from './project-deployment-executor';

const VERSION = 'a'.repeat(40);
const PROJECT = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  templateId: 'node',
  repoPath: '/workspace/acme-api',
  scmProvider: 'gitea',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: null,
  repoUrl: 'https://git.test/acme/api',
};

const ENVIRONMENT = {
  id: 'env-1',
  provider: 'docker',
  targetId: null,
  target: null,
  allocation: null,
  buildArtifact: null,
};

function make(
  overrides: {
    project?: Record<string, unknown>;
    environment?: Record<string, unknown>;
    operation?: Record<string, unknown> | null;
    deployment?: Record<string, unknown>;
    targets?: Record<string, unknown>;
    lifecycle?: Record<string, unknown>;
    operations?: Record<string, unknown>;
    preparation?: Record<string, unknown>;
    artifacts?: Record<string, unknown>;
    agentDelivery?: Record<string, unknown>;
  } = {},
) {
  const updateMany = jest.fn(async () => ({ count: 1 }));
  const prisma = {
    project: { findUniqueOrThrow: jest.fn(async () => overrides.project ?? PROJECT) },
    environment: {
      findUniqueOrThrow: jest.fn(async () => overrides.environment ?? ENVIRONMENT),
      updateMany,
    },
    deploymentOperation: {
      findUnique: jest.fn(async () =>
        overrides.operation === undefined
          ? { id: 'operation-1', buildArtifactId: 'artifact-1', buildArtifact: null }
          : overrides.operation,
      ),
    },
  };
  const cleanup = jest.fn();
  const preparation = overrides.preparation ?? {
    prepare: jest.fn(async () => ({
      repoPath: '/prepared/source',
      artifactDir: undefined,
      protectedWebLayout: false,
      writableDirs: undefined,
      envVars: { NODE_ENV: 'production' },
      cleanup,
    })),
  };
  const deployment = overrides.deployment ?? {
    deploy: jest.fn(async () => ({ status: 'running', url: 'http://host:8080' })),
    teardown: jest.fn(async () => undefined),
  };
  const targets = overrides.targets ?? {
    connection: jest.fn(() => undefined),
    allocation: jest.fn(() => undefined),
  };
  const lifecycle = overrides.lifecycle ?? {
    usesSharedSshPort: jest.fn(() => false),
    allocateSharedSshPort: jest.fn(),
    emptyState: jest.fn((statusReason: string | null) => ({
      status: 'empty',
      version: null,
      buildArtifactId: null,
      url: null,
      statusReason,
      allocatedPort: null,
      activeOperationId: null,
      deploymentRequired: false,
    })),
  };
  const operations = {
    advancePhase: jest.fn(async () => undefined),
    reportProgress: jest.fn(),
    cancelled: jest.fn(async () => false),
    complete: jest.fn(async () => undefined),
    ...overrides.operations,
  };
  const artifacts = overrides.artifacts ?? {
    ensureImageAvailable: jest.fn(async () => true),
    captureRegistryArtifact: jest.fn(async () => ({
      id: 'artifact-captured',
      projectId: 'project-1',
      commitSha: VERSION,
      providerRunId: '',
      digest: 'd'.repeat(64),
      status: 'available',
      storageKind: 'object-store',
      storageRef: 'artifact/key',
    })),
  };
  const agentDelivery = overrides.agentDelivery ?? {
    queueDeployment: jest.fn(async () => undefined),
  };
  const executor = new ProjectDeploymentExecutor(
    prisma as never,
    {
      get: jest.fn(() => ({
        id: 'node',
        port: 3000,
        healthPath: '/health',
        compatibleProviders: ['docker'],
      })),
    } as never,
    deployment as never,
    targets as never,
    lifecycle as never,
    operations as never,
    preparation as never,
    artifacts as never,
    agentDelivery as never,
    jest.fn(async () => ({ username: 'alice', token: 'token' })),
  );
  return {
    executor,
    prisma,
    updateMany,
    cleanup,
    preparation,
    deployment,
    targets,
    lifecycle,
    operations,
    artifacts,
    agentDelivery,
  };
}

describe('ProjectDeploymentExecutor', () => {
  it('publishes a successful deployment only through the claimed operation', async () => {
    const ctx = make();

    await expect(
      ctx.executor.execute('project-1', 'dev', VERSION, true, 'operation-1'),
    ).resolves.toBe(true);

    expect((ctx.operations as any).advancePhase).toHaveBeenNthCalledWith(
      1,
      'operation-1',
      'assigned',
      'Assigned to control plane',
    );
    expect((ctx.operations as any).advancePhase).toHaveBeenNthCalledWith(
      2,
      'operation-1',
      'running',
      'Preparing deployment',
    );

    expect((ctx.deployment as any).deploy).toHaveBeenCalledWith(
      'docker',
      expect.objectContaining({
        projectName: 'acme-api',
        version: VERSION,
        repoPath: '/prepared/source',
        imageRef: `127.0.0.1:3001/acme/api:${VERSION}`,
        allowBuildFallback: false,
        envVars: { NODE_ENV: 'production' },
      }),
    );
    expect(ctx.updateMany).toHaveBeenLastCalledWith({
      where: {
        projectId: 'project-1',
        name: 'dev',
        activeOperationId: 'operation-1',
      },
      data: expect.objectContaining({
        status: 'running',
        version: VERSION,
        buildArtifactId: 'artifact-1',
        deploymentRequired: false,
      }),
    });
    expect(ctx.cleanup).toHaveBeenCalledTimes(1);
  });

  it('captures and publishes an immutable Gitea artifact for a direct Docker target', async () => {
    const ctx = make({
      operation: { id: 'operation-1', buildArtifactId: null, buildArtifact: null },
    });

    await expect(
      ctx.executor.execute('project-1', 'dev', VERSION, true, 'operation-1'),
    ).resolves.toBe(true);

    expect((ctx.artifacts as any).captureRegistryArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gitea', fullName: 'acme/api' }),
      expect.objectContaining({ id: 'project-1', workspaceId: 'workspace-1' }),
      'operation-1',
      VERSION,
    );
    expect(ctx.updateMany).toHaveBeenLastCalledWith({
      where: {
        projectId: 'project-1',
        name: 'dev',
        activeOperationId: 'operation-1',
      },
      data: expect.objectContaining({
        status: 'running',
        version: VERSION,
        buildArtifactId: 'artifact-captured',
      }),
    });
  });

  it('tears down provider state and does not publish after cancellation', async () => {
    const operations = {
      reportProgress: jest.fn(),
      cancelled: jest.fn(async () => true),
      complete: jest.fn(async () => undefined),
    };
    const deployment = {
      deploy: jest.fn(async () => ({ status: 'running', url: 'http://host:8080' })),
      teardown: jest.fn(async () => ({ warning: 'target cleanup required' })),
    };
    const ctx = make({ operations, deployment });

    await expect(
      ctx.executor.execute('project-1', 'dev', VERSION, true, 'operation-1'),
    ).resolves.toBe(false);

    expect(deployment.teardown).toHaveBeenCalled();
    expect((ctx.lifecycle as any).emptyState).toHaveBeenCalledWith(
      'Cleanup pending: target cleanup required',
    );
    expect(operations.complete).toHaveBeenCalledWith(
      'operation-1',
      'cancelled',
      'Cancelled by user',
    );
    expect(ctx.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects a GitHub deploy that is not bound to an available verified artifact', async () => {
    const ctx = make({
      project: {
        ...PROJECT,
        scmProvider: 'github',
        scmInstallationId: 'installation-1',
        repoUrl: 'https://github.com/acme/api',
      },
      operation: {
        id: 'operation-1',
        buildArtifactId: 'artifact-1',
        buildArtifact: {
          id: 'artifact-1',
          projectId: 'another-project',
          commitSha: VERSION,
          providerRunId: 'run-1',
          status: 'available',
          storageKind: 'object-store',
          storageRef: 'artifact/key',
        },
      },
    });

    await expect(
      ctx.executor.execute('project-1', 'dev', VERSION, true, 'operation-1'),
    ).rejects.toThrow('no verified build artifact');
    expect((ctx.preparation as any).prepare).not.toHaveBeenCalled();
    expect((ctx.deployment as any).deploy).not.toHaveBeenCalled();
  });

  it('always releases prepared material when a provider reports failure', async () => {
    const ctx = make({
      deployment: {
        deploy: jest.fn(async () => ({ status: 'failed', url: '', reason: 'health check failed' })),
      },
    });

    await expect(
      ctx.executor.execute('project-1', 'prod', VERSION, true, 'operation-1'),
    ).rejects.toThrow('health check failed');
    expect(ctx.cleanup).toHaveBeenCalledTimes(1);
  });

  it('queues an Agent deployment without preparing source, secrets or using local Docker', async () => {
    const artifact = {
      id: 'artifact-1',
      projectId: 'project-1',
      commitSha: VERSION,
      providerRunId: 'run-1',
      status: 'available',
      storageKind: 'object-store',
      storageRef: 'artifact/key',
    };
    const environment = {
      ...ENVIRONMENT,
      targetId: 'target-1',
      target: { id: 'target-1', scope: 'user' },
      allocation: { id: 'allocation-1', targetId: 'target-1', namespace: 'workspace-1' },
    };
    const operation = { id: 'operation-1', buildArtifactId: 'artifact-1', buildArtifact: artifact };
    const ctx = make({ environment, operation });
    (ctx.targets as any).ensureAllocation = jest.fn(async () => environment.allocation);
    (ctx.targets as any).assertAcceptsDeploy = jest.fn(async () => undefined);

    await expect(
      ctx.executor.execute('project-1', 'dev', VERSION, true, 'operation-1'),
    ).resolves.toBe(false);

    expect((ctx.agentDelivery as any).queueDeployment).toHaveBeenCalledWith(
      'operation-1',
      expect.objectContaining({
        projectSlug: 'acme-api',
        imageRef: `127.0.0.1:3001/acme/api:${VERSION}`,
        containerPort: 3000,
        healthPath: '/health',
      }),
    );
    expect((ctx.preparation as any).prepare).not.toHaveBeenCalled();
    expect((ctx.deployment as any).deploy).not.toHaveBeenCalled();
  });
});
