import { ProvisioningService } from './provisioning.service';

describe('ProvisioningService', () => {
  it('starts a running operation at the validate step', async () => {
    let createArgs: { data?: Record<string, unknown> } | undefined;
    const prisma = {
      provisioningOperation: {
        create: jest.fn(async (args: { data?: Record<string, unknown> }) => {
          createArgs = args;
          return { id: 'op1' };
        }),
      },
    };
    const service = new ProvisioningService(prisma as never);
    const id = await service.start('ws1', 'api', 'import');
    expect(id).toBe('op1');
    expect(createArgs?.data).toMatchObject({ workspaceId: 'ws1', projectName: 'api', kind: 'import', status: 'running', step: 'validate' });
  });

  it('audits request acceptance and the authoritative terminal result', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const audit = {
      record: jest.fn(async () => undefined),
      recordOperationResult: jest.fn(async () => undefined),
    };
    const prisma = {
      provisioningOperation: {
        create: jest.fn(async () => ({ id: operationId })),
        update: jest.fn(async () => ({})),
      },
    };
    const service = new ProvisioningService(prisma as never, audit);

    await service.start('ws1', 'api', 'create', {
      requestedById: 'user-1',
      request: { name: 'api' },
    });
    await service.succeed(operationId, 'project-1');

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      action: 'project.creation_requested',
      outcome: 'accepted',
      operation: { type: 'provisioning', id: operationId },
    }));
    expect(audit.recordOperationResult).toHaveBeenCalledWith('provisioning', operationId);
  });

  it('records success with the project id and marks it done', async () => {
    let updateArgs: { data?: Record<string, unknown> } | undefined;
    const prisma = {
      provisioningOperation: { update: jest.fn(async (a: { data?: Record<string, unknown> }) => { updateArgs = a; return {}; }) },
    };
    await new ProvisioningService(prisma as never).succeed('op1', 'p1');
    expect(updateArgs?.data).toMatchObject({ status: 'succeeded', step: 'done', projectId: 'p1' });
  });

  it('never throws when recording a step fails', async () => {
    const prisma = { provisioningOperation: { update: jest.fn(async () => { throw new Error('db down'); }) } };
    const service = new ProvisioningService(prisma as never);
    await expect(service.step('op1', 'repository')).resolves.toBeUndefined();
    await expect(service.fail('op1', 'boom')).resolves.toBeUndefined();
  });

  it('truncates long failure messages', async () => {
    let updateArgs: { data?: { message?: string } } | undefined;
    const prisma = { provisioningOperation: { update: jest.fn(async (a: { data?: { message?: string } }) => { updateArgs = a; return {}; }) } };
    await new ProvisioningService(prisma as never).fail('op1', 'x'.repeat(1000));
    expect((updateArgs?.data?.message ?? '').length).toBe(500);
  });

  it('writes intent before allowing an effect to enter applying', async () => {
    const prisma = {
      provisioningOperation: { updateMany: jest.fn(async () => ({ count: 1 })) },
      provisioningEffect: {
        create: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new ProvisioningService(prisma as never);
    await service.planEffect('op1', 'secrets:initpad', 'secrets', { repository: 'acme/api' });
    await service.beginEffect('op1', 'secrets:initpad');
    expect(prisma.provisioningEffect.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ operationId: 'op1', key: 'secrets:initpad', status: 'planned' }),
    });
    expect(prisma.provisioningEffect.updateMany).toHaveBeenCalledWith({
      where: { operationId: 'op1', key: 'secrets:initpad', status: { in: ['planned'] } },
      data: { status: 'applying', error: null },
    });
  });

  it('refuses an invalid effect transition', async () => {
    const prisma = { provisioningEffect: { updateMany: jest.fn(async () => ({ count: 0 })) } };
    await expect(
      new ProvisioningService(prisma as never).completeEffect('op1', 'repository:create'),
    ).rejects.toThrow('not in the expected state');
  });

  it('marks an expired operation interrupted and makes applying effects explicit', async () => {
    const prisma = {
      provisioningOperation: {
        findMany: jest.fn(async () => [{ id: 'op1' }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      provisioningEffect: { updateMany: jest.fn(async () => ({ count: 2 })) },
    };
    const recovered = await new ProvisioningService(prisma as never).reconcileStale();
    expect(recovered).toBe(1);
    expect(prisma.provisioningOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'op1', status: { in: ['running', 'cleaning', 'retrying'] } }),
        data: expect.objectContaining({ status: 'interrupted', leaseOwner: null }),
      }),
    );
    expect(prisma.provisioningEffect.updateMany).toHaveBeenCalledWith({
      where: { operationId: 'op1', status: 'applying' },
      data: expect.objectContaining({ status: 'reconciliation_required' }),
    });
  });

  it('allows retry only for the original user after every effect is safe', () => {
    const service = new ProvisioningService({} as never);
    const operation = {
      id: 'op1', workspaceId: 'ws1', projectId: null, projectName: 'api',
      kind: 'create', status: 'failed', requestedById: 'u1', request: { name: 'api' },
      retryOfId: null, attempt: 1,
      effects: [{
        key: 'repository:create', kind: 'repository', status: 'compensated',
        metadata: null, error: null, createdAt: new Date(), appliedAt: null,
        compensatedAt: new Date(),
      }],
    };
    expect(service.isRetryable(operation, 'u1')).toBe(true);
    expect(service.isRetryable(operation, 'u2')).toBe(false);
    operation.effects[0].status = 'reconciliation_required';
    expect(service.isRetryable(operation, 'u1')).toBe(false);
    expect(service.needsCleanup(operation)).toBe(true);
  });

  it('creates a retry attempt and retires its predecessor in one transaction', async () => {
    const tx = {
      provisioningOperation: {
        create: jest.fn(async () => ({ id: 'op2' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<string>) => run(tx)) };
    const service = new ProvisioningService(prisma as never);
    await expect(service.start('ws1', 'api', 'create', {
      requestedById: 'u1',
      request: { name: 'api', templateId: 'node-api' },
      retryOfId: 'op1',
      attempt: 2,
    })).resolves.toBe('op2');
    expect(tx.provisioningOperation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'op1', status: 'retrying' }),
      data: expect.objectContaining({ status: 'retried', leaseOwner: null }),
    });
  });
});
