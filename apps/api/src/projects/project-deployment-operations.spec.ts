import { BadRequestException } from '@nestjs/common';
import { ProjectDeploymentOperations } from './project-deployment-operations';

describe('ProjectDeploymentOperations', () => {
  it('claims an idle environment and records an immutable target snapshot', async () => {
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          targetId: 'target-1',
          target: { name: 'ESO' },
          provider: 'sftp',
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      deploymentOperation: {
        create: jest.fn(async () => ({ id: 'operation-1' })),
        update: jest.fn(),
      },
    };
    const operations = new ProjectDeploymentOperations(prisma as never);

    await expect(
      operations.begin('project-1', 'prod', 'redeploy', 'abc123', 'artifact-1'),
    ).resolves.toBe('operation-1');
    expect(prisma.deploymentOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        environmentId: 'env-1',
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

  it('cancels the losing operation when two requests race for one environment', async () => {
    const update = jest.fn(async () => undefined);
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1',
          targetId: null,
          target: null,
          provider: 'docker',
        })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      deploymentOperation: {
        create: jest.fn(async () => ({ id: 'operation-loser' })),
        update,
      },
    };
    const operations = new ProjectDeploymentOperations(prisma as never);

    await expect(
      operations.begin('project-1', 'dev', 'redeploy', 'abc123'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'operation-loser' },
      data: expect.objectContaining({
        status: 'cancelled',
        message: 'Another operation is already active',
        finishedAt: expect.any(Date),
      }),
    });
  });

  it('recovers running and user-cancelled operations after an API restart', async () => {
    const operationUpdate = jest.fn(async () => undefined);
    const environmentUpdate = jest.fn(async () => ({ count: 1 }));
    const transaction = jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));
    const prisma = {
      deploymentOperation: {
        findMany: jest.fn(async () => [
          { id: 'running-1', status: 'running', agentJob: null },
          { id: 'cancelled-1', status: 'cancelled', agentJob: null },
        ]),
        update: operationUpdate,
      },
      environment: { updateMany: environmentUpdate },
      $transaction: transaction,
    };
    const operations = new ProjectDeploymentOperations(prisma as never);

    await operations.recoverInterrupted();

    expect(operationUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'running-1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(operationUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'cancelled-1' },
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
          { id: 'agent-operation', status: 'running', agentJob: { id: 'job-1' } },
        ]),
        update: operationUpdate,
      },
      environment: { updateMany: environmentUpdate },
      $transaction: jest.fn(),
    } as never);

    await operations.recoverInterrupted();

    expect(operationUpdate).not.toHaveBeenCalled();
    expect(environmentUpdate).not.toHaveBeenCalled();
  });

  it('clears the environment lock even if operation history cannot be updated', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      deploymentOperation: {
        update: jest.fn(async () => {
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
    } as never);

    operations.reportProgress('operation-1', 'project-1', 'prod', 'Uploading 5/10 files');
    await Promise.resolve();

    expect(operationUpdate).toHaveBeenCalledWith({
      where: { id: 'operation-1', status: 'running' },
      data: { message: 'Uploading 5/10 files' },
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
});
