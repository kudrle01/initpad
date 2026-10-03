import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProjectDeploymentOperations } from './project-deployment-operations';

const targetRevision = new Date('2026-09-07T10:00:00.000Z');
const allocationRevision = new Date('2026-09-07T10:05:00.000Z');

function withCapacity<T extends Record<string, any>>(prisma: T): T {
  const client: Record<string, any> = prisma;
  client.workspace ??= {
    findUnique: jest.fn(async () => ({ maxConcurrentOperations: 10 })),
  };
  client.provisioningOperation ??= { count: jest.fn(async () => 0) };
  client.deploymentOperation.count ??= jest.fn(async () => 0);
  client.$transaction ??= jest.fn(async (run: (transaction: T) => unknown) => run(prisma));
  return prisma;
}

describe('ProjectDeploymentOperations', () => {
  it('claims an idle environment and records an immutable target snapshot', async () => {
    const prisma = withCapacity({
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          targetId: 'target-1',
          target: { name: 'ESO' },
          provider: 'sftp',
          project: { id: 'project-1', name: 'api', workspaceId: 'workspace-1' },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      deploymentOperation: {
        create: jest.fn(async ({ data }) => ({ id: 'operation-1', ...data })),
        update: jest.fn(),
      },
    });
    const operations = new ProjectDeploymentOperations(prisma as never);

    await expect(
      operations.begin('project-1', 'prod', 'redeploy', 'abc123', 'artifact-1'),
    ).resolves.toBe('operation-1');
    expect(prisma.deploymentOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        correlationId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        environmentId: 'env-1',
        phase: 'queued',
        targetIdSnapshot: 'target-1',
        targetName: 'ESO',
        providerSnapshot: 'sftp',
        buildArtifactId: 'artifact-1',
      }),
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'env-1', activeOperationId: null },
      data: expect.objectContaining({
        activeOperationId: 'operation-1',
        status: 'deploying',
        deploymentRequired: true,
      }),
    });
  });

  it('audits the accepted user request and terminal deployment projection', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const audit = {
      record: jest.fn(async () => undefined),
      recordOperationResult: jest.fn(async () => undefined),
    };
    const prisma = withCapacity({
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          targetId: null,
          target: null,
          provider: 'docker',
          status: 'running',
          statusReason: null,
          deploymentRequired: false,
          project: { id: 'project-1', name: 'api', workspaceId: 'workspace-1' },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      deploymentOperation: {
        create: jest.fn(async ({ data }) => ({ id: operationId, ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ correlationId: operationId })),
      },
    });
    const operations = new ProjectDeploymentOperations(prisma as never, audit);

    await operations.begin('project-1', 'test', 'promote', 'abc123', null, 'user-1');
    await operations.complete(operationId, 'succeeded');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        action: 'environment.promotion_requested',
        outcome: 'accepted',
        operation: { type: 'deployment', id: operationId },
      }),
    );
    expect(audit.recordOperationResult).toHaveBeenCalledWith('deployment', operationId);
  });

  it('cancels the losing operation when two requests race for one environment', async () => {
    const update = jest.fn(async () => undefined);
    const prisma = withCapacity({
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          targetId: null,
          target: null,
          provider: 'docker',
          project: { id: 'project-1', name: 'api', workspaceId: 'workspace-1' },
        })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      deploymentOperation: {
        create: jest.fn(async ({ data }) => ({ id: 'operation-loser', ...data })),
        update,
      },
    });
    const operations = new ProjectDeploymentOperations(prisma as never);

    await expect(operations.begin('project-1', 'dev', 'redeploy', 'abc123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'operation-loser' },
      data: expect.objectContaining({
        status: 'cancelled',
        message: 'Another operation is already active',
        finishedAt: expect.any(Date),
      }),
    });
  });

  it('refuses an approved production snapshot after its config revision changes', async () => {
    const create = jest.fn();
    const operations = new ProjectDeploymentOperations({
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'prod-env',
          targetId: 'target-1',
          allocationId: 'allocation-1',
          configRevision: 8,
          target: { name: 'Production', updatedAt: targetRevision },
          allocation: { updatedAt: allocationRevision },
          provider: 'docker',
          project: { id: 'project-1', name: 'api', workspaceId: 'workspace-1' },
        })),
        updateMany: jest.fn(),
      },
      deploymentOperation: { create },
    } as never);

    await expect(
      operations.begin('project-1', 'prod', 'promote', 'abc123', 'artifact-1', 'reviewer-1', {
        stateToken: 'token',
        targetId: 'target-1',
        allocationId: 'allocation-1',
        configRevision: 7,
        targetRevision,
        allocationRevision,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('recovers running and user-cancelled operations after an API restart', async () => {
    const old = new Date('2026-01-01T00:00:00.000Z');
    const operationUpdate = jest.fn(async () => ({ count: 1 }));
    const environmentUpdate = jest.fn(async () => ({ count: 1 }));
    const transaction = jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));
    const prisma = {
      deploymentOperation: {
        findMany: jest.fn(async () => [
          {
            id: 'running-1',
            status: 'running',
            kind: 'deploy',
            createdAt: old,
            executionOwner: null,
            executionGeneration: 0,
            executionLeaseExpiresAt: null,
            agentJobs: [],
          },
          {
            id: 'cancelled-1',
            status: 'cancelled',
            kind: 'deploy',
            createdAt: old,
            executionOwner: null,
            executionGeneration: 0,
            executionLeaseExpiresAt: null,
            agentJobs: [],
          },
        ]),
        updateMany: operationUpdate,
      },
      environment: { updateMany: environmentUpdate },
      $transaction: transaction,
    };
    const operations = new ProjectDeploymentOperations(prisma as never);

    await operations.recoverInterrupted();

    expect(operationUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: 'running-1', executionGeneration: 0 }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(operationUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cancelled-1', executionGeneration: 0 }),
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(environmentUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'empty',
          version: null,
          activeOperationId: null,
        }),
      }),
    );
  });

  it('preserves a durable Agent operation across an API restart', async () => {
    const operationUpdate = jest.fn();
    const environmentUpdate = jest.fn();
    const operations = new ProjectDeploymentOperations({
      deploymentOperation: {
        findMany: jest.fn(async () => [
          {
            id: 'agent-operation',
            status: 'running',
            kind: 'deploy',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            executionOwner: null,
            executionGeneration: 0,
            executionLeaseExpiresAt: null,
            agentJobs: [{ id: 'job-1' }],
          },
        ]),
        updateMany: operationUpdate,
      },
      environment: { updateMany: environmentUpdate },
      $transaction: jest.fn(),
    } as never);

    await operations.recoverInterrupted();

    expect(operationUpdate).not.toHaveBeenCalled();
    expect(environmentUpdate).not.toHaveBeenCalled();
  });

  it('does not clear an operation that another replica claimed during recovery', async () => {
    const environmentUpdate = jest.fn();
    const operations = new ProjectDeploymentOperations({
      deploymentOperation: {
        findMany: jest.fn(async () => [
          {
            id: 'operation-1',
            status: 'running',
            kind: 'deploy',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            executionOwner: 'old-owner',
            executionGeneration: 3,
            executionLeaseExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
            agentJobs: [],
          },
        ]),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      environment: { updateMany: environmentUpdate },
    } as never);

    await operations.recoverInterrupted();

    expect(environmentUpdate).not.toHaveBeenCalled();
  });

  it('clears the environment lock even if operation history cannot be updated', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      deploymentOperation: {
        updateMany: jest.fn(async () => {
          throw new Error('history unavailable');
        }),
      },
      environment: { updateMany },
    };
    const operations = new ProjectDeploymentOperations(prisma as never);

    await expect(operations.complete('operation-1', 'failed', 'boom')).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith({
      where: { activeOperationId: 'operation-1' },
      data: { activeOperationId: null },
    });
  });

  it('records health-check failures as an unhealthy terminal phase', async () => {
    const operationUpdate = jest.fn(async (_args: unknown) => undefined);
    const operations = new ProjectDeploymentOperations({
      deploymentOperation: {
        updateMany: jest.fn(async (args) => {
          await operationUpdate(args);
          return { count: 1 };
        }),
        findUnique: jest.fn(async () => ({ correlationId: 'correlation-1' })),
      },
      environment: { updateMany: jest.fn(async () => ({ count: 1 })) },
    } as never);

    await operations.complete(
      'operation-1',
      'failed',
      'Health check at /health did not return 2xx',
    );

    expect(operationUpdate).toHaveBeenCalledWith({
      where: { id: 'operation-1', executionOwner: null, finishedAt: null },
      data: expect.objectContaining({ status: 'failed', phase: 'unhealthy' }),
    });
  });

  it('advances active phases only from an earlier phase', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const operations = new ProjectDeploymentOperations({
      deploymentOperation: { updateMany },
    } as never);

    await operations.advancePhase('operation-1', 'verifying', 'Verifying deployment');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'operation-1',
        status: 'running',
        finishedAt: null,
        phase: { in: ['queued', 'assigned', 'running'] },
        executionOwner: null,
      },
      data: { phase: 'verifying', message: 'Verifying deployment' },
    });
  });

  it.each([
    [null, true],
    [{ status: 'cancelled' }, true],
    [{ status: 'running' }, false],
  ])('reports cancellation state %#', async (operation, expected) => {
    const prisma = {
      deploymentOperation: { findUnique: jest.fn(async () => operation) },
    };
    const operations = new ProjectDeploymentOperations(prisma as never);

    await expect(operations.cancelled('operation-1')).resolves.toBe(expected);
  });

  it('publishes provider progress to operation history and the live environment', async () => {
    const operationUpdate = jest.fn(async () => ({ count: 1 }));
    const environmentUpdate = jest.fn(async () => ({ count: 1 }));
    const operations = new ProjectDeploymentOperations({
      deploymentOperation: { updateMany: operationUpdate },
      environment: { updateMany: environmentUpdate },
      $queryRaw: jest.fn(async () => [{ generation: 1 }]),
    } as never);

    await operations.runWithExecutionLease('operation-1', async () => {
      operations.reportProgress('operation-1', 'project-1', 'prod', 'Uploading 5/10 files');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(operationUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'operation-1',
        status: 'running',
        executionGeneration: 1,
      }),
      data: { message: 'Uploading 5/10 files' },
    });
    expect(operationUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'operation-1',
        status: 'running',
        finishedAt: null,
        phase: { in: ['queued', 'assigned'] },
        executionGeneration: 1,
      }),
      data: { phase: 'running' },
    });
    expect(environmentUpdate).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        name: 'prod',
        activeOperationId: 'operation-1',
      },
      data: { statusReason: 'Uploading 5/10 files' },
    });
  });

  it('renews a slow execution and completes only through its generation fence', async () => {
    jest.useFakeTimers();
    let finish!: () => void;
    const providerWork = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const query = jest.fn(async () => [{ generation: 4 }]);
    const operationUpdate = jest.fn(async () => ({ count: 1 }));
    const environmentUpdate = jest.fn(async () => ({ count: 1 }));
    const operations = new ProjectDeploymentOperations({
      $queryRaw: query,
      deploymentOperation: {
        updateMany: operationUpdate,
        findUnique: jest.fn(async () => ({ correlationId: 'correlation-1' })),
      },
      environment: { updateMany: environmentUpdate },
    } as never);

    const running = operations.runWithExecutionLease('operation-1', async () => {
      await providerWork;
      await operations.complete('operation-1', 'succeeded');
    });
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(2);

    finish();
    await running;
    expect(query).toHaveBeenCalledTimes(3);
    expect(operationUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'operation-1',
        executionGeneration: 4,
      }),
      data: expect.objectContaining({
        status: 'succeeded',
        executionOwner: null,
        executionLeaseExpiresAt: null,
      }),
    });
    expect(environmentUpdate).toHaveBeenCalledWith({
      where: { activeOperationId: 'operation-1' },
      data: { activeOperationId: null },
    });
    jest.useRealTimers();
  });

  it('refuses terminal publication after another replica takes the execution lease', async () => {
    const operationUpdate = jest.fn();
    const operations = new ProjectDeploymentOperations({
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ generation: 2 }])
        .mockResolvedValueOnce([]),
      deploymentOperation: { updateMany: operationUpdate },
      environment: { updateMany: jest.fn() },
    } as never);

    await expect(
      operations.runWithExecutionLease('operation-1', () =>
        operations.complete('operation-1', 'succeeded'),
      ),
    ).rejects.toThrow('execution lease was lost');
    expect(operationUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded' }) }),
    );
  });

  it('releases process ownership after handing durable work to an Agent', async () => {
    const operationUpdate = jest.fn(async () => ({ count: 1 }));
    const operations = new ProjectDeploymentOperations({
      $queryRaw: jest.fn(async () => [{ generation: 7 }]),
      deploymentOperation: { updateMany: operationUpdate },
    } as never);

    await expect(
      operations.runWithExecutionLease('operation-1', async () => 'agent-job-queued'),
    ).resolves.toBe('agent-job-queued');

    expect(operationUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'operation-1',
        executionGeneration: 7,
      }),
      data: { executionOwner: null, executionLeaseExpiresAt: null },
    });
  });
});
