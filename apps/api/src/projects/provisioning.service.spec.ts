import { LEASE_RENEW_MS, ProvisioningService } from './provisioning.service';

function withCapacity<T extends Record<string, any>>(prisma: T): T {
  const client: Record<string, any> = prisma;
  client.workspace ??= {
    findUnique: jest.fn(async () => ({ maxConcurrentOperations: 10 })),
  };
  client.deploymentOperation ??= { count: jest.fn(async () => 0) };
  client.provisioningOperation.count ??= jest.fn(async () => 0);
  client.provisioningOperation.findFirst ??= jest.fn(async () => null);
  client.$transaction ??= jest.fn(async (run: (transaction: T) => unknown) => run(prisma));
  return prisma;
}

describe('ProvisioningService', () => {
  it('starts a running operation at the validate step', async () => {
    let createArgs: { data?: Record<string, unknown> } | undefined;
    const prisma = withCapacity({
      provisioningOperation: {
        create: jest.fn(async (args: { data?: Record<string, unknown> }) => {
          createArgs = args;
          return { id: 'op1' };
        }),
      },
    });
    const service = new ProvisioningService(prisma as never);
    const id = await service.start('ws1', 'api', 'import');
    expect(id).toBe('op1');
    expect(createArgs?.data).toMatchObject({
      workspaceId: 'ws1',
      projectName: 'api',
      kind: 'import',
      status: 'running',
      step: 'validate',
    });
  });

  it('audits request acceptance and the authoritative terminal result', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const audit = {
      record: jest.fn(async () => undefined),
      recordOperationResult: jest.fn(async () => undefined),
    };
    const prisma = withCapacity({
      provisioningOperation: {
        create: jest.fn(async () => ({ id: operationId })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    });
    const service = new ProvisioningService(prisma as never, audit);

    await service.start('ws1', 'api', 'create', {
      requestedById: 'user-1',
      request: { name: 'api' },
    });
    await service.succeed(operationId, 'project-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        action: 'project.creation_requested',
        outcome: 'accepted',
        operation: { type: 'provisioning', id: operationId },
      }),
    );
    expect(audit.recordOperationResult).toHaveBeenCalledWith('provisioning', operationId);
  });

  it('records success with the project id and marks it done', async () => {
    let updateArgs: { data?: Record<string, unknown> } | undefined;
    const prisma = {
      provisioningOperation: {
        updateMany: jest.fn(async (a: { data?: Record<string, unknown> }) => {
          updateArgs = a;
          return { count: 1 };
        }),
      },
    };
    await new ProvisioningService(prisma as never).succeed('op1', 'p1');
    expect(updateArgs?.data).toMatchObject({ status: 'succeeded', step: 'done', projectId: 'p1' });
  });

  it('never throws when recording a step fails', async () => {
    const prisma = {
      provisioningOperation: {
        updateMany: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const service = new ProvisioningService(prisma as never);
    await expect(service.step('op1', 'repository')).resolves.toBeUndefined();
    await expect(service.fail('op1', 'boom')).resolves.toBeUndefined();
  });

  it('truncates long failure messages', async () => {
    let updateArgs: { data?: { message?: string } } | undefined;
    const prisma = {
      provisioningOperation: {
        updateMany: jest.fn(async (a: { data?: { message?: string } }) => {
          updateArgs = a;
          return { count: 1 };
        }),
      },
    };
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
      data: expect.objectContaining({
        operationId: 'op1',
        key: 'secrets:initpad',
        status: 'planned',
      }),
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
        where: expect.objectContaining({
          id: 'op1',
          status: { in: ['running', 'cleaning', 'retrying'] },
        }),
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
      id: 'op1',
      workspaceId: 'ws1',
      projectId: null,
      projectName: 'api',
      kind: 'create',
      status: 'failed',
      requestedById: 'u1',
      request: { name: 'api' },
      retryOfId: null,
      attempt: 1,
      effects: [
        {
          key: 'repository:create',
          kind: 'repository',
          status: 'compensated',
          metadata: null,
          error: null,
          createdAt: new Date(),
          appliedAt: null,
          compensatedAt: new Date(),
        },
      ],
    };
    expect(service.isRetryable(operation, 'u1')).toBe(true);
    expect(service.isRetryable(operation, 'u2')).toBe(false);
    operation.effects[0].status = 'reconciliation_required';
    expect(service.isRetryable(operation, 'u1')).toBe(false);
    expect(service.needsCleanup(operation)).toBe(true);
  });

  it('creates a retry attempt and retires its predecessor in one transaction', async () => {
    const tx = {
      workspace: {
        findUnique: jest.fn(async () => ({ maxConcurrentOperations: 10 })),
      },
      deploymentOperation: { count: jest.fn(async () => 0) },
      provisioningOperation: {
        create: jest.fn(async () => ({ id: 'op2' })),
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (run: (client: typeof tx) => Promise<string>) => run(tx)),
    };
    const service = new ProvisioningService(prisma as never);
    await expect(
      service.start('ws1', 'api', 'create', {
        requestedById: 'u1',
        request: { name: 'api', templateId: 'node-api' },
        retryOfId: 'op1',
        attempt: 2,
      }),
    ).resolves.toBe('op2');
    expect(tx.provisioningOperation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'op1', status: 'retrying' }),
      data: expect.objectContaining({ status: 'retried', leaseOwner: null }),
    });
  });

  it('dismisses only a finished failure and keeps the record', async () => {
    const prisma = {
      provisioningOperation: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const service = new ProvisioningService(prisma as never);
    const operation = {
      id: 'op1',
      workspaceId: 'ws1',
      projectId: null,
      projectName: 'demo',
      kind: 'create',
      status: 'running',
      attempt: 1,
      effects: [],
    } as never;

    await expect(service.dismiss(operation, 'u1')).rejects.toThrow(
      'Only a failed provisioning operation can be dismissed',
    );
    expect(prisma.provisioningOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'op1', status: { in: ['failed', 'interrupted'] }, dismissedAt: null },
      data: { dismissedAt: expect.any(Date), dismissedById: 'u1' },
    });
  });

  it('refuses a second create of the same name while the first holds a live lease', async () => {
    const create = jest.fn();
    const findFirst = jest.fn(async () => ({ projectName: 'api' }));
    const prisma = withCapacity({ provisioningOperation: { create, findFirst } });

    await expect(
      new ProvisioningService(prisma as never).start('ws1', 'api', 'create'),
    ).rejects.toThrow("Project 'api' is already being created");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'ws1',
          kind: 'create',
          status: 'running',
          leaseExpiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('reserves an import by repository id even after the operation was renamed', async () => {
    const findFirst = jest.fn(async () => ({ projectName: 'acme/api' }));
    const prisma = withCapacity({ provisioningOperation: { create: jest.fn(), findFirst } });

    await expect(
      new ProvisioningService(prisma as never).start('ws1', '101', 'import'),
    ).rejects.toThrow("Repository 'acme/api' is already being imported");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ projectName: '101' }, { request: { path: ['repositoryId'], equals: '101' } }],
        }),
      }),
    );
  });

  it('fences terminal transitions by the lease owner', async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const audit = { record: jest.fn(), recordOperationResult: jest.fn() };
    const service = new ProvisioningService(
      { provisioningOperation: { updateMany } } as never,
      audit as never,
    );

    await service.succeed('op1', 'p1');
    await service.fail('op1', 'boom');
    await service.step('op1', 'ci');

    for (const [args] of updateMany.mock.calls as unknown as Array<[{ where: unknown }]>) {
      expect(args.where).toEqual({ id: 'op1', status: 'running', leaseOwner: expect.any(String) });
    }
    // A lost lease is not reported as this process's terminal result.
    expect(audit.recordOperationResult).not.toHaveBeenCalled();
  });

  it('renews the lease on a timer for the whole operation', async () => {
    jest.useFakeTimers();
    try {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const service = new ProvisioningService({ provisioningOperation: { updateMany } } as never);
      const release = service.holdLease('op1');

      await jest.advanceTimersByTimeAsync(LEASE_RENEW_MS * 3);
      expect(updateMany).toHaveBeenCalledTimes(3);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'op1', status: 'running', leaseOwner: expect.any(String) },
        data: { leaseExpiresAt: expect.any(Date) },
      });

      release();
      await jest.advanceTimersByTimeAsync(LEASE_RENEW_MS * 3);
      expect(updateMany).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never interrupts an operation this process is still executing', async () => {
    const findMany = jest.fn(async () => [{ id: 'op1' }]);
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const service = new ProvisioningService({
      provisioningOperation: { findMany, updateMany },
      provisioningEffect: { updateMany: jest.fn() },
    } as never);
    const release = service.holdLease('op1');
    try {
      await expect(service.reconcileStale()).resolves.toBe(0);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { notIn: ['op1'] } }) }),
      );
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('reconciles on read paths at most once per interval', async () => {
    const findMany = jest.fn(async () => []);
    const service = new ProvisioningService({
      provisioningOperation: { findMany, findFirst: jest.fn(async () => null) },
    } as never);

    await service.latestForProject('p1');
    await service.latestForProject('p1');
    await service.latestForProject('p1');

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('explains why a provisioning operation cannot be retried', () => {
    const service = new ProvisioningService({} as never);
    const base = {
      id: 'op1',
      workspaceId: 'ws1',
      projectId: null,
      projectName: 'api',
      kind: 'create',
      status: 'failed',
      requestedById: 'u1',
      request: { name: 'api' },
      retryOfId: null,
      attempt: 1,
      effects: [] as never[],
    };
    expect(service.retryBlockedReason(base, 'u1')).toBeNull();
    expect(service.retryBlockedReason(base, 'u2')).toContain('Only the person who started');
    expect(service.retryBlockedReason({ ...base, attempt: 5 }, 'u1')).toContain('maximum of 5');
    expect(service.retryBlockedReason({ ...base, status: 'running' }, 'u1')).toContain(
      'still running',
    );
    expect(service.retryBlockedReason({ ...base, status: 'retried' }, 'u1')).toContain(
      'newer attempt',
    );
    expect(service.retryBlockedReason({ ...base, request: null }, 'u1')).toContain('legacy');
    expect(
      service.retryBlockedReason({ ...base, effects: [{ status: 'applied' }] as never[] }, 'u1'),
    ).toContain('Run Clean up first');
  });
});
