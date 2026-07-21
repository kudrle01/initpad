import { ProjectsService } from './projects.service';
import { config } from '../config';

function make(prisma: Record<string, unknown>, artifactStore: Record<string, unknown>) {
  return new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    artifactStore as never,
  );
}

// A creation time comfortably older than the retention window.
function stale(): Date {
  return new Date(Date.now() - (config.artifactStore.retentionDays + 5) * 86_400_000);
}

describe('ProjectsService.runArtifactRetention', () => {
  it('deletes the object and demotes the row for an unreferenced expired artifact', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'artifacts/ws/pr/a1/d.tar' }]),
        updateMany,
      },
      environment: { count: jest.fn(async () => 0) },
      deploymentOperation: { count: jest.fn(async () => 0) },
    };
    const del = jest.fn(async () => undefined);
    const service = make(prisma, { delete: del });

    await expect(service.runArtifactRetention()).resolves.toEqual({ removed: 1, kept: 0 });
    expect(del).toHaveBeenCalledWith('artifacts/ws/pr/a1/d.tar');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ status: 'failed', storageKind: null, storageRef: null }),
      }),
    );
  });

  it('protects an artifact still referenced by an environment', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 1) },
      deploymentOperation: { count: jest.fn(async () => 0) },
    };
    const del = jest.fn();
    const service = make(prisma, { delete: del });

    await expect(service.runArtifactRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(del).not.toHaveBeenCalled();
    expect(prisma.buildArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('protects an artifact still needed by an unfinished deployment operation', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 0) },
      deploymentOperation: { count: jest.fn(async () => 1) },
    };
    const del = jest.fn();
    const service = make(prisma, { delete: del });

    await expect(service.runArtifactRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(del).not.toHaveBeenCalled();
  });

  it('keeps the row when the object delete fails (no false success)', async () => {
    const prisma = {
      buildArtifact: {
        findMany: jest.fn(async () => [{ id: 'a1', storageRef: 'k' }]),
        updateMany: jest.fn(),
      },
      environment: { count: jest.fn(async () => 0) },
      deploymentOperation: { count: jest.fn(async () => 0) },
    };
    const del = jest.fn(async () => {
      throw new Error('storage offline');
    });
    const service = make(prisma, { delete: del });

    await expect(service.runArtifactRetention()).resolves.toEqual({ removed: 0, kept: 1 });
    expect(prisma.buildArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the query to expired object-store artifacts only', async () => {
    const findMany = jest.fn(async () => []);
    const prisma = {
      buildArtifact: { findMany, updateMany: jest.fn() },
      environment: { count: jest.fn() },
      deploymentOperation: { count: jest.fn() },
    };
    const service = make(prisma, { delete: jest.fn() });
    const now = new Date('2026-07-20T00:00:00Z');

    await service.runArtifactRetention(now);

    const arg = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0];
    expect(arg.where).toMatchObject({ storageKind: 'object-store' });
    expect(arg.where).toHaveProperty('createdAt');
  });
});
