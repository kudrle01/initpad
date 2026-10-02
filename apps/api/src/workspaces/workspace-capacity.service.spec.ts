import { ConflictException } from '@nestjs/common';
import { WorkspaceCapacityService } from './workspace-capacity.service';

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workspace-1',
    name: 'Team Alpha',
    maxProjects: 2,
    maxMembers: 3,
    maxTargets: 1,
    maxConcurrentOperations: 2,
    maxArtifactBytes: 1000n,
    ...overrides,
  };
}

function prismaMock(overrides: Record<string, unknown> = {}) {
  return {
    workspace: {
      findUnique: jest.fn(async () => workspace()),
      findMany: jest.fn(async () => [{ id: 'workspace-1' }]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    project: { count: jest.fn(async () => 1) },
    workspaceMember: { count: jest.fn(async () => 2) },
    targetAllocation: { count: jest.fn(async () => 1) },
    deploymentOperation: { count: jest.fn(async () => 1) },
    provisioningOperation: { count: jest.fn(async () => 1) },
    buildArtifact: {
      aggregate: jest.fn(async () => ({ _sum: { sizeBytes: 750n } })),
    },
    ...overrides,
  };
}

describe('WorkspaceCapacityService', () => {
  it('returns JSON-safe limits, usage and remaining capacity', async () => {
    const service = new WorkspaceCapacityService(prismaMock() as never);

    await expect(service.snapshot('workspace-1')).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceName: 'Team Alpha',
      limits: {
        projects: 2,
        members: 3,
        targets: 1,
        concurrentOperations: 2,
        artifactBytes: '1000',
      },
      usage: {
        projects: 1,
        members: 2,
        targets: 1,
        concurrentOperations: 2,
        artifactBytes: '750',
      },
      remaining: {
        projects: 1,
        members: 1,
        targets: 0,
        concurrentOperations: 0,
        artifactBytes: '250',
      },
    });
  });

  it.each([
    ['projects', 'project quota reached'],
    ['members', 'member quota reached'],
    ['targets', 'deployment server quota reached'],
    ['concurrentOperations', 'concurrent operation quota reached'],
    ['artifactBytes', 'artifact storage quota exceeded'],
  ] as const)('rejects new %s beyond the workspace limit', async (resource, message) => {
    const service = new WorkspaceCapacityService(prismaMock() as never);
    await expect(service.assertAvailable('workspace-1', resource, 1000)).rejects.toEqual(
      expect.objectContaining<Partial<ConflictException>>({
        message: expect.stringContaining(message),
      }),
    );
  });

  it('stores artifact storage in bytes while the admin boundary uses whole GiB', async () => {
    const prisma = prismaMock();
    const service = new WorkspaceCapacityService(prisma as never);

    await service.update('workspace-1', {
      maxProjects: 25,
      maxMembers: 50,
      maxTargets: 10,
      maxConcurrentOperations: 8,
      maxArtifactStorageGiB: 20,
    });

    expect(prisma.workspace.updateMany).toHaveBeenCalledWith({
      where: { id: 'workspace-1' },
      data: expect.objectContaining({ maxArtifactBytes: 20n * 1024n * 1024n * 1024n }),
    });
  });
});
