import { BadRequestException } from '@nestjs/common';
import { config } from '../config';
import { ProjectEnvironmentLifecycle } from './project-environment-lifecycle';

const PROJECT = {
  id: 'project-1',
  templateId: 'node',
  scmProvider: 'gitea',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: null,
  repoUrl: 'https://git.test/acme/api',
};

function make(
  prisma: Record<string, unknown>,
  deployment: Record<string, unknown> = {},
  operations: Record<string, unknown> = {},
  agentDelivery: Record<string, unknown> = {},
) {
  return new ProjectEnvironmentLifecycle(
    prisma as never,
    {
      get: jest.fn(() => ({
        port: 3000,
        healthPath: '/health',
        startCommand: 'node server.js',
      })),
    } as never,
    deployment as never,
    {
      connection: jest.fn(() => undefined),
      allocation: jest.fn(() => undefined),
    } as never,
    operations as never,
    agentDelivery as never,
  );
}

describe('ProjectEnvironmentLifecycle', () => {
  const savedPortBase = config.providers.ssh.appPortBase;
  const savedPortSlots = config.providers.ssh.appPortSlots;

  afterEach(() => {
    config.providers.ssh.appPortBase = savedPortBase;
    config.providers.ssh.appPortSlots = savedPortSlots;
  });

  it('stops a running environment without discarding its deployed version', async () => {
    const update = jest.fn(async () => undefined);
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => PROJECT) },
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'env-1',
          provider: 'docker',
          status: 'running',
          activeOperationId: null,
          target: null,
          allocation: null,
        })),
        update,
      },
    };
    const deployment = { stop: jest.fn(async () => undefined) };
    const lifecycle = make(prisma, deployment);

    await lifecycle.stop('project-1', 'dev');

    expect(deployment.stop).toHaveBeenCalledWith(
      'docker',
      expect.objectContaining({ projectName: 'acme-api', env: 'dev' }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { projectId_name: { projectId: 'project-1', name: 'dev' } },
      data: { status: 'stopped', statusReason: null },
    });
  });

  it('queues Agent stop without touching the control-plane Docker provider', async () => {
    const environment = {
      id: 'env-1',
      provider: 'docker',
      status: 'running',
      version: 'a'.repeat(40),
      buildArtifactId: 'artifact-1',
      activeOperationId: null,
      target: { scope: 'user' },
      allocation: { id: 'allocation-1' },
      buildArtifact: null,
    };
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => PROJECT) },
      environment: { findUniqueOrThrow: jest.fn(async () => environment), updateMany: jest.fn() },
    };
    const deployment = { stop: jest.fn() };
    const operations = { begin: jest.fn(async () => 'operation-1') };
    const agentDelivery = { queueLifecycle: jest.fn(async () => undefined) };
    const lifecycle = make(prisma, deployment, operations, agentDelivery);

    await lifecycle.stop('project-1', 'dev');

    expect(operations.begin).toHaveBeenCalledWith(
      'project-1', 'dev', 'stop', 'a'.repeat(40), 'artifact-1', undefined,
    );
    expect(agentDelivery.queueLifecycle).toHaveBeenCalledWith(
      'operation-1',
      'stop',
      expect.objectContaining({ projectSlug: 'acme-api', containerPort: 3000 }),
    );
    expect(deployment.stop).not.toHaveBeenCalled();
  });

  it('rejects stop while another operation owns the environment lock', async () => {
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => PROJECT) },
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({
          provider: 'docker',
          status: 'running',
          activeOperationId: 'operation-1',
        })),
      },
    };
    const deployment = { stop: jest.fn() };
    const lifecycle = make(prisma, deployment);

    await expect(lifecycle.stop('project-1', 'dev')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deployment.stop).not.toHaveBeenCalled();
  });

  it('does not start a second runtime for an environment that is already running', async () => {
    const prisma = {
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({
          status: 'running',
          version: 'a'.repeat(40),
        })),
      },
    };
    const operations = { begin: jest.fn() };
    const lifecycle = make(prisma, {}, operations);

    await expect(lifecycle.start('project-1', 'dev')).rejects.toThrow('is not stopped');
    expect(operations.begin).not.toHaveBeenCalled();
  });

  it('keeps external cleanup debt visible while releasing local environment state', async () => {
    const update = jest.fn(async () => undefined);
    const environment = {
      id: 'env-1',
      provider: 'sftp',
      status: 'failed',
      version: 'a'.repeat(40),
      activeOperationId: null,
      target: null,
      allocation: null,
      buildArtifact: null,
    };
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => PROJECT) },
      environment: { findUniqueOrThrow: jest.fn(async () => environment), update },
    };
    const deployment = {
      teardown: jest.fn(async () => ({ warning: 'Administrator cleanup required' })),
    };
    const lifecycle = make(prisma, deployment);

    await lifecycle.remove('project-1', 'prod');

    expect(update).toHaveBeenCalledWith({
      where: { projectId_name: { projectId: 'project-1', name: 'prod' } },
      data: expect.objectContaining({
        status: 'empty',
        version: null,
        allocatedPort: null,
        activeOperationId: null,
        statusReason: 'Cleanup pending: Administrator cleanup required',
      }),
    });
  });

  it('cancels a CI wait synchronously so a late callback cannot revive dev', async () => {
    const environmentUpdate = jest.fn(async () => undefined);
    const operationUpdate = jest.fn(async () => undefined);
    const transaction = jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => PROJECT) },
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'env-1',
          provider: 'docker',
          activeOperationId: 'operation-1',
          target: null,
          allocation: null,
          buildArtifact: null,
        })),
        update: environmentUpdate,
      },
      deploymentOperation: {
        findUnique: jest.fn(async () => ({ id: 'operation-1', kind: 'ci-retry' })),
        update: operationUpdate,
      },
      $transaction: transaction,
    };
    const deployment = { teardown: jest.fn() };
    const lifecycle = make(
      prisma,
      deployment,
      { complete: jest.fn(async () => undefined) },
    );

    await lifecycle.remove('project-1', 'dev');

    expect(operationUpdate).toHaveBeenCalledWith({
      where: { id: 'operation-1' },
      data: expect.objectContaining({ status: 'cancelled', finishedAt: expect.any(Date) }),
    });
    expect(environmentUpdate).toHaveBeenCalledWith({
      where: { id: 'env-1' },
      data: expect.objectContaining({
        status: 'empty',
        version: null,
        activeOperationId: null,
      }),
    });
    expect(deployment.teardown).not.toHaveBeenCalled();
  });

  it('retries the next SSH port only after a unique-constraint race', async () => {
    config.providers.ssh.appPortBase = 9000;
    config.providers.ssh.appPortSlots = 3;
    const update = jest
      .fn()
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce(undefined);
    const prisma = {
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({ allocatedPort: null })),
        findMany: jest.fn(async () => [{ allocatedPort: 9000 }]),
        update,
      },
    };
    const lifecycle = make(prisma);

    await expect(lifecycle.allocateSharedSshPort('project-1', 'dev')).resolves.toBe(9002);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { projectId_name: { projectId: 'project-1', name: 'dev' } },
      data: { allocatedPort: 9001 },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { projectId_name: { projectId: 'project-1', name: 'dev' } },
      data: { allocatedPort: 9002 },
    });
  });

  it('does not hide a database failure as an exhausted SSH port pool', async () => {
    config.providers.ssh.appPortBase = 9000;
    config.providers.ssh.appPortSlots = 3;
    const prisma = {
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({ allocatedPort: null })),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => {
          throw new Error('database unavailable');
        }),
      },
    };
    const lifecycle = make(prisma);

    await expect(
      lifecycle.allocateSharedSshPort('project-1', 'dev'),
    ).rejects.toThrow('database unavailable');
  });

  it('releases a shared SSH port when Start is cancelled during provider work', async () => {
    config.providers.ssh.appPortBase = 9000;
    config.providers.ssh.appPortSlots = 3;
    const environment = {
      id: 'env-1',
      provider: 'ssh',
      status: 'stopped',
      version: 'a'.repeat(40),
      activeOperationId: 'operation-1',
      allocatedPort: null,
      target: { scope: 'builtin' },
      allocation: null,
      buildArtifact: null,
    };
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      project: { findUniqueOrThrow: jest.fn(async () => PROJECT) },
      environment: {
        findUniqueOrThrow: jest.fn(async () => environment),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => undefined),
        updateMany,
      },
    };
    const deployment = {
      start: jest.fn(async () => ({ status: 'running', url: 'http://host:9000' })),
      teardown: jest.fn(async () => undefined),
    };
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operations = {
      begin: jest.fn(async () => 'operation-1'),
      cancelled: jest.fn(async () => true),
      complete: jest.fn(async () => finish()),
    };
    const lifecycle = make(prisma, deployment, operations);

    await lifecycle.start('project-1', 'dev');
    await completed;

    expect(updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', name: 'dev', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'empty',
        version: null,
        allocatedPort: null,
        activeOperationId: null,
        deploymentRequired: false,
      }),
    });
  });
});
