import { GatewayRoutesService } from './gateway-routes.service';

const environment = {
  id: 'environment-immutable-id',
  name: 'dev',
  targetId: 'target-1',
  allocationId: 'allocation-1',
  project: { name: 'Customer Portal', workspaceId: 'workspace-1' },
  target: {
    id: 'target-1',
    routingMode: 'managed-gateway',
    publicUrl: 'https://apps.example.test',
  },
  allocation: {
    id: 'allocation-1',
    targetId: 'target-1',
    workspaceId: 'workspace-1',
    publicUrl: 'https://team-alpha.apps.example.test',
    status: 'active',
  },
};

const route = {
  id: 'route-1',
  environmentId: environment.id,
  targetId: environment.targetId,
  allocationId: environment.allocationId,
  hostname: 'customer-portal-dev-0123456789ab.team-alpha.apps.example.test',
  publicUrl: 'https://customer-portal-dev-0123456789ab.team-alpha.apps.example.test',
  desiredState: 'reserved',
  desiredRevision: null,
  observedState: 'absent',
  observedRevision: null,
  generation: 0,
  lastError: null,
  reconciledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GatewayRoutesService stable reservations', () => {
  it('reserves one hostname inside the allocation sub-zone', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, string> }) => ({
      ...route,
      ...data,
    }));
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment) },
      gatewayRoute: {
        findUnique: jest.fn(async () => null),
        create,
      },
    };

    const result = await new GatewayRoutesService(prisma as never).reserve(environment.id);

    expect(result.hostname).toMatch(
      /^customer-portal-dev-[a-f0-9]{12}\.team-alpha\.apps\.example\.test$/,
    );
    expect(result.publicUrl).toBe(`https://${result.hostname}`);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('queues a bounded generation-fenced Caddy intent after a successful preflight', async () => {
    const managedEnvironment = {
      ...environment,
      target: {
        ...environment.target,
        kind: 'docker',
        scope: 'user',
        workspaceId: 'workspace-1',
        gatewayAdapter: 'caddy',
        gatewayPreflightStatus: 'passed',
        agent: {
          credentialHash: 'hash',
          disabledAt: null,
          version: '0.8.0',
        },
      },
      allocation: { ...environment.allocation, namespace: 'team-alpha' },
    };
    const createdJob = {
      id: 'job-1',
      status: 'queued',
      payload: { generation: 1 },
    };
    const transaction = jest.fn();
    const prisma = {
      environment: { findUnique: jest.fn(async () => managedEnvironment) },
      gatewayRoute: {
        findUnique: jest.fn(async () => route),
        create: jest.fn(),
        update: jest
          .fn()
          .mockResolvedValueOnce({ ...route, generation: 1 })
          .mockResolvedValueOnce({ ...route, generation: 1, reconcileJobId: 'job-1' }),
      },
      agentJob: {
        findUnique: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async (_input: unknown) => createdJob),
      },
      $transaction: transaction,
    };
    transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
      callback(prisma),
    );
    const request = {
      requestId: '323e4567-e89b-42d3-a456-426614174000',
      desiredState: 'active' as const,
      revision: 'abc123',
      projectSlug: 'customer-portal',
      containerPort: 8080,
      healthPath: '/health',
      workloadSlot: 'a1b2c3d4e5f6',
      activation: 'deploy' as const,
      deploymentOperationId: '323e4567-e89b-42d3-a456-426614174000',
      operationStep: 2,
    };

    await expect(
      new GatewayRoutesService(prisma as never).queueReconcile(environment.id, request),
    ).resolves.toEqual({ routeId: route.id, jobId: 'job-1', generation: 1, status: 'queued' });

    expect(prisma.agentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: 'target-1',
        allocationId: 'allocation-1',
        deploymentOperationId: request.deploymentOperationId,
        operationStep: 2,
        gatewayRouteId: route.id,
        kind: 'gateway-route',
        payload: {
          adapter: 'caddy',
          routeId: route.id,
          generation: 1,
          desiredState: 'active',
          hostname: route.hostname,
          allocationId: 'allocation-1',
          namespace: 'team-alpha',
          projectSlug: 'customer-portal',
          environment: 'dev',
          revision: 'abc123',
          containerPort: 8080,
          healthPath: '/health',
          workloadSlot: 'a1b2c3d4e5f6',
          activation: 'deploy',
        },
      }),
    });
    const queuedPayload = (
      prisma.agentJob.create.mock.calls[0]?.[0] as {
        data: { payload: Record<string, unknown> };
      }
    ).data.payload;
    expect(queuedPayload).not.toHaveProperty('adminUrl');
    expect(queuedPayload).not.toHaveProperty('upstream');
  });

  it('does not queue routes before preflight or for an outdated Agent', async () => {
    const managedEnvironment = {
      ...environment,
      target: {
        ...environment.target,
        kind: 'docker',
        scope: 'user',
        workspaceId: 'workspace-1',
        gatewayAdapter: 'caddy',
        gatewayPreflightStatus: 'pending',
        agent: { credentialHash: 'hash', disabledAt: null, version: '0.5.0' },
      },
      allocation: { ...environment.allocation, namespace: 'team-alpha' },
    };
    const prisma = {
      environment: { findUnique: jest.fn(async () => managedEnvironment) },
      gatewayRoute: { findUnique: jest.fn(async () => route), create: jest.fn() },
      agentJob: { findUnique: jest.fn(), create: jest.fn() },
    };
    const service = new GatewayRoutesService(prisma as never);
    const request = {
      requestId: '323e4567-e89b-42d3-a456-426614174000',
      desiredState: 'active' as const,
      revision: 'abc123',
      projectSlug: 'customer-portal',
      containerPort: 8080,
      healthPath: '/health',
      workloadSlot: 'a1b2c3d4e5f6',
      activation: 'deploy' as const,
    };
    await expect(service.queueReconcile(environment.id, request)).rejects.toThrow('preflighted');

    managedEnvironment.target.gatewayPreflightStatus = 'passed';
    await expect(service.queueReconcile(environment.id, request)).rejects.toThrow('0.8.0');
    expect(prisma.agentJob.create).not.toHaveBeenCalled();
  });

  it('returns the existing reservation unchanged after a project rename', async () => {
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          ...environment,
          project: { ...environment.project, name: 'Renamed Portal' },
        })),
      },
      gatewayRoute: {
        findUnique: jest.fn(async () => route),
        create: jest.fn(),
      },
    };

    await expect(new GatewayRoutesService(prisma as never).reserve(environment.id)).resolves.toBe(
      route,
    );
    expect(prisma.gatewayRoute.create).not.toHaveBeenCalled();
  });

  it('reuses the exact winner of a concurrent reservation race', async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(route);
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment) },
      gatewayRoute: {
        findUnique,
        create: jest.fn(async () => {
          throw new Error('unique constraint');
        }),
      },
    };

    await expect(new GatewayRoutesService(prisma as never).reserve(environment.id)).resolves.toBe(
      route,
    );
  });

  it('never silently rebinds a reserved hostname to another target', async () => {
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment) },
      gatewayRoute: {
        findUnique: jest.fn(async () => ({ ...route, targetId: 'old-target' })),
        create: jest.fn(),
      },
    };

    await expect(new GatewayRoutesService(prisma as never).reserve(environment.id)).rejects.toThrow(
      'different target',
    );
  });
});
