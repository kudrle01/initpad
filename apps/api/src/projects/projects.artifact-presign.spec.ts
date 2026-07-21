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

describe('ProjectsService.presignArtifactDownload', () => {
  const savedTtl = config.artifactStore.presignTtlSeconds;
  afterEach(() => {
    config.artifactStore.presignTtlSeconds = savedTtl;
  });

  it('returns a bounded, job-scoped presigned URL for an available object-store artifact', async () => {
    config.artifactStore.presignTtlSeconds = 180;
    const presignGet = jest.fn(async () => 'https://bucket/obj?sig=abc');
    const prisma = {
      buildArtifact: {
        findFirst: jest.fn(async () => ({ storageRef: 'artifacts/ws/pr/a1/d.tar' })),
      },
    };
    const service = make(prisma, { presignGet });

    await expect(service.presignArtifactDownload('a1')).resolves.toEqual({
      url: 'https://bucket/obj?sig=abc',
      expiresInSeconds: 180,
    });
    expect(presignGet).toHaveBeenCalledWith('artifacts/ws/pr/a1/d.tar', 180);
    // Query is scoped to available object-store artifacts only.
    const where = (prisma.buildArtifact.findFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ id: 'a1', status: 'available', storageKind: 'object-store' });
  });

  it('rejects when no downloadable artifact exists', async () => {
    const presignGet = jest.fn();
    const prisma = { buildArtifact: { findFirst: jest.fn(async () => null) } };
    const service = make(prisma, { presignGet });

    await expect(service.presignArtifactDownload('missing')).rejects.toThrow(
      'No downloadable build artifact',
    );
    expect(presignGet).not.toHaveBeenCalled();
  });
});
