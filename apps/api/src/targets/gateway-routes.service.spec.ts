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

    await expect(new GatewayRoutesService(prisma as never).reserve(environment.id))
      .resolves.toBe(route);
    expect(prisma.gatewayRoute.create).not.toHaveBeenCalled();
  });

  it('reuses the exact winner of a concurrent reservation race', async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(route);
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment) },
      gatewayRoute: {
        findUnique,
        create: jest.fn(async () => { throw new Error('unique constraint'); }),
      },
    };

    await expect(new GatewayRoutesService(prisma as never).reserve(environment.id))
      .resolves.toBe(route);
  });

  it('never silently rebinds a reserved hostname to another target', async () => {
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment) },
      gatewayRoute: {
        findUnique: jest.fn(async () => ({ ...route, targetId: 'old-target' })),
        create: jest.fn(),
      },
    };

    await expect(new GatewayRoutesService(prisma as never).reserve(environment.id))
      .rejects.toThrow('different target');
  });
});
