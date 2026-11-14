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

  describe('instance overview (audit P2)', () => {
    it('reads one page in a single aggregated query instead of per-workspace snapshots', async () => {
      const prisma = {
        $queryRaw: jest.fn(async () => [
          {
            ...workspace(),
            projects: 2,
            members: 1,
            targets: 0,
            concurrentOperations: 3,
            artifactBytes: 1500n,
          },
        ]),
        workspace: { count: jest.fn(async () => 41), findUnique: jest.fn() },
        project: { count: jest.fn() },
      };
      const service = new WorkspaceCapacityService(prisma as never);

      const page = await service.list({ limit: 25, offset: 25 });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
      expect(prisma.project.count).not.toHaveBeenCalled();
      const sql = (prisma.$queryRaw.mock.calls[0] as unknown[])[0] as {
        sql: string;
        values: unknown[];
      };
      expect(sql.sql).toMatch(/LIMIT \? OFFSET \?/);
      expect(sql.values.slice(-2)).toEqual([25, 25]);
      expect(page).toMatchObject({ total: 41, limit: 25, offset: 25 });
      expect(page.items[0]).toMatchObject({
        workspaceId: 'workspace-1',
        usage: { projects: 2, concurrentOperations: 3, artifactBytes: '1500' },
        remaining: { projects: 0, members: 2, concurrentOperations: 0, artifactBytes: '0' },
      });
    });
  });
});
