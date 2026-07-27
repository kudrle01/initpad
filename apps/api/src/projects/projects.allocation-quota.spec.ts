import { BadRequestException } from '@nestjs/common';

import { ProjectsService } from './projects.service';

function make(prisma: Record<string, unknown>) {
  return new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function assertDeploy(service: ProjectsService, allocationId: string, envId: string) {
  return (service as unknown as {
    assertAllocationAcceptsDeploy: (a: string, e: string) => Promise<void>;
  }).assertAllocationAcceptsDeploy(allocationId, envId);
}

describe('ProjectsService.assertAllocationAcceptsDeploy (ADR-060 P2.5)', () => {
  it('blocks a new deploy on a disabled allocation', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({
          status: 'disabled', maxEnvironments: 50, _count: { environments: 1 },
        })),
      },
      environment: { count: jest.fn() },
    };
    const service = make(prisma);
    await expect(assertDeploy(service, 'alloc-1', 'env-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects binding a new environment beyond the quota', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({
          status: 'active', maxEnvironments: 2, _count: { environments: 2 },
        })),
      },
      // The environment is not yet bound to this allocation.
      environment: { count: jest.fn(async () => 0) },
    };
    const service = make(prisma);
    await expect(assertDeploy(service, 'alloc-1', 'env-new')).rejects.toThrow(/quota reached/);
  });

  it('allows re-deploying an environment already bound (over quota is fine)', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({
          status: 'active', maxEnvironments: 2, _count: { environments: 2 },
        })),
      },
      environment: { count: jest.fn(async () => 1) }, // already bound
    };
    const service = make(prisma);
    await expect(assertDeploy(service, 'alloc-1', 'env-1')).resolves.toBeUndefined();
  });

  it('allows a new environment under the quota', async () => {
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(async () => ({
          status: 'active', maxEnvironments: 50, _count: { environments: 3 },
        })),
      },
      environment: { count: jest.fn(async () => 0) },
    };
    const service = make(prisma);
    await expect(assertDeploy(service, 'alloc-1', 'env-new')).resolves.toBeUndefined();
  });
});
