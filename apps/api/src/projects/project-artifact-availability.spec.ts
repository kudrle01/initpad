import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';

const REPOSITORY = {
  provider: 'github',
  repositoryId: '101',
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  repoUrl: 'https://github.com/acme/api',
  installationId: 'installation-1',
} as const;

describe('ProjectArtifactLifecycle image availability', () => {
  it('uses an already-cached verified image without downloading the object', async () => {
    const store = { getToFile: jest.fn() };
    const deployment = {
      hasImage: jest.fn(async () => true),
      loadImageArchive: jest.fn(),
    };
    const prisma = {
      buildArtifact: {
        findFirst: jest.fn(async () => ({
          storageRef: 'artifact/key',
          commitSha: 'a'.repeat(40),
          providerRunId: 'run-1',
          digest: 'd'.repeat(64),
        })),
      },
    };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      deployment as never,
    );

    await expect(
      lifecycle.ensureImageAvailable(REPOSITORY, 'project-1', 'artifact-1'),
    ).resolves.toBe(true);
    expect(store.getToFile).not.toHaveBeenCalled();
    expect(deployment.loadImageArchive).not.toHaveBeenCalled();
  });

  it('rehydrates verified bytes and removes the private temporary directory', async () => {
    const bytes = Buffer.from('verified image archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    let downloadedPath = '';
    const store = {
      getToFile: jest.fn(async (_key: string, path: string) => {
        downloadedPath = path;
        writeFileSync(path, bytes);
      }),
    };
    const deployment = {
      hasImage: jest.fn(async () => false),
      loadImageArchive: jest.fn(async () => undefined),
    };
    const prisma = {
      buildArtifact: {
        findFirst: jest.fn(async () => ({
          storageRef: 'artifact/key',
          commitSha: 'a'.repeat(40),
          providerRunId: 'run-1',
          digest,
        })),
      },
    };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      deployment as never,
    );

    await expect(
      lifecycle.ensureImageAvailable(REPOSITORY, 'project-1', 'artifact-1'),
    ).resolves.toBe(true);
    expect(deployment.loadImageArchive).toHaveBeenCalledWith(
      downloadedPath,
      `ghcr.io/acme/api:${'a'.repeat(40)}-run-1`,
    );
    expect(existsSync(downloadedPath)).toBe(false);
  });

  it('rejects corrupt object bytes and still removes the temporary directory', async () => {
    let downloadedPath = '';
    const store = {
      getToFile: jest.fn(async (_key: string, path: string) => {
        downloadedPath = path;
        writeFileSync(path, 'corrupt');
      }),
    };
    const deployment = {
      hasImage: jest.fn(async () => false),
      loadImageArchive: jest.fn(),
    };
    const prisma = {
      buildArtifact: {
        findFirst: jest.fn(async () => ({
          storageRef: 'artifact/key',
          commitSha: 'a'.repeat(40),
          providerRunId: 'run-1',
          digest: 'd'.repeat(64),
        })),
      },
    };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      deployment as never,
    );

    await expect(
      lifecycle.ensureImageAvailable(REPOSITORY, 'project-1', 'artifact-1'),
    ).resolves.toBe(false);
    expect(deployment.loadImageArchive).not.toHaveBeenCalled();
    expect(existsSync(downloadedPath)).toBe(false);
  });
});

describe('ProjectArtifactLifecycle registry capture for verified Gitea delivery', () => {
  const GITEA_REPOSITORY = {
    ...REPOSITORY,
    provider: 'gitea',
    repoUrl: 'https://git.example.test/acme/api',
    installationId: null,
  } as const;

  it('exports an exact tested image into tenant-scoped durable storage and binds the operation', async () => {
    let uploadedBytes = '';
    const store = {
      durable: true,
      head: jest.fn(async () => ({ sizeBytes: 25 })),
      put: jest.fn(async (_key: string, path: string) => {
        uploadedBytes = readFileSync(path, 'utf8');
      }),
      delete: jest.fn(async () => undefined),
    };
    const deployment = {
      saveImageArchive: jest.fn(async (_imageRef: string, path: string) => {
        writeFileSync(path, 'verified-registry-archive');
      }),
    };
    const created = {
      id: 'artifact-1',
      projectId: 'project-1',
      sourceProvider: 'gitea-oci',
      providerArtifactId: `project-1:${'a'.repeat(40)}`,
      providerRunId: '',
      commitSha: 'a'.repeat(40),
      name: 'initpad-image.tar',
      digest: createHash('sha256').update('verified-registry-archive').digest('hex'),
      sizeBytes: 25n,
      expiresAt: new Date(),
      status: 'available',
      storageKind: 'object-store',
      storageRef: 'stored/key',
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const accepted = { ...created, status: 'accepted', storageKind: null, storageRef: null };
    const operationUpdate = jest.fn(async () => ({ count: 1 }));
    const prisma: Record<string, unknown> = {
      $queryRaw: jest.fn(async () => [{ id: 'artifact-1', generation: 1 }]),
      workspace: { findUnique: jest.fn(async () => ({ maxArtifactBytes: 1024n })) },
      buildArtifact: {
        findUnique: jest.fn(async () => null),
        findUniqueOrThrow: jest.fn(async () => created),
        aggregate: jest.fn(async () => ({ _sum: { sizeBytes: 0n } })),
        create: jest.fn(async () => accepted),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      deploymentOperation: { updateMany: operationUpdate },
    };
    prisma.$transaction = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma));
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      deployment as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        'operation-1',
        'a'.repeat(40),
      ),
    ).resolves.toBe(created);

    expect(deployment.saveImageArchive).toHaveBeenCalledWith(
      `127.0.0.1:3001/acme/api:${'a'.repeat(40)}`,
      expect.any(String),
    );
    expect(uploadedBytes).toBe('verified-registry-archive');
    expect(store.put).toHaveBeenCalledWith(
      expect.stringMatching(/^artifacts\/workspace-1\/project-1\//),
      expect.any(String),
      expect.objectContaining({ contentType: 'application/x-tar' }),
    );
    expect(operationUpdate).toHaveBeenCalledWith({
      where: { id: 'operation-1', status: 'running', environment: { projectId: 'project-1' } },
      data: { buildArtifactId: 'artifact-1' },
    });
  });

  it('refuses verified delivery when storage is only process memory', async () => {
    const lifecycle = new ProjectArtifactLifecycle(
      {} as never,
      { durable: false } as never,
      { saveImageArchive: jest.fn() } as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        'operation-1',
        'a'.repeat(40),
      ),
    ).rejects.toThrow(/durable artifact storage/);
  });

  it('does not publish an artifact record when the source registry is unavailable', async () => {
    let temporaryPath = '';
    const create = jest.fn();
    const store = {
      durable: true,
      put: jest.fn(),
      delete: jest.fn(),
    };
    const deployment = {
      saveImageArchive: jest.fn(async (_imageRef: string, path: string) => {
        temporaryPath = path;
        throw new Error('registry unavailable');
      }),
    };
    const lifecycle = new ProjectArtifactLifecycle(
      {
        buildArtifact: { findUnique: jest.fn(async () => null), create },
        deploymentOperation: { updateMany: jest.fn() },
      } as never,
      store as never,
      deployment as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        'operation-1',
        'a'.repeat(40),
      ),
    ).rejects.toThrow('registry unavailable');

    expect(store.put).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(temporaryPath).not.toBe('');
    expect(existsSync(temporaryPath)).toBe(false);
  });

  it('records failure and removes partial data when object storage rejects an upload', async () => {
    let temporaryPath = '';
    const accepted = {
      id: 'artifact-1',
      projectId: 'project-1',
      sourceProvider: 'gitea-oci',
      providerArtifactId: `project-1:${'a'.repeat(40)}`,
      providerRunId: '',
      commitSha: 'a'.repeat(40),
      name: 'initpad-image.tar',
      digest: createHash('sha256').update('verified-registry-archive').digest('hex'),
      sizeBytes: 25n,
      expiresAt: new Date(),
      status: 'accepted',
      storageKind: null,
      storageRef: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const create = jest.fn(async () => accepted);
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const store = {
      durable: true,
      put: jest.fn(async () => {
        throw new Error('object storage unavailable');
      }),
      delete: jest.fn(async () => undefined),
    };
    const deployment = {
      saveImageArchive: jest.fn(async (_imageRef: string, path: string) => {
        temporaryPath = path;
        writeFileSync(path, 'verified-registry-archive');
      }),
    };
    const prisma: Record<string, unknown> = {
      $queryRaw: jest.fn(async () => [{ id: 'artifact-1', generation: 1 }]),
      workspace: { findUnique: jest.fn(async () => ({ maxArtifactBytes: 1024n })) },
      buildArtifact: {
        findUnique: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({ _sum: { sizeBytes: 0n } })),
        create,
        updateMany,
      },
      deploymentOperation: { updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma));
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      deployment as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        'operation-1',
        'a'.repeat(40),
      ),
    ).rejects.toThrow('object storage unavailable');

    expect(create).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(store.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^artifacts\/workspace-1\/project-1\//),
    );
    expect(temporaryPath).not.toBe('');
    expect(existsSync(temporaryPath)).toBe(false);
  });

  it('does not delete shared storage after losing the registry capture lease', async () => {
    const digest = createHash('sha256').update('verified-registry-archive').digest('hex');
    const accepted = {
      id: 'artifact-1',
      projectId: 'project-1',
      sourceProvider: 'gitea-oci',
      providerArtifactId: `project-1:${'a'.repeat(40)}`,
      providerRunId: '',
      commitSha: 'a'.repeat(40),
      name: 'initpad-image.tar',
      digest,
      sizeBytes: 25n,
      expiresAt: new Date(),
      status: 'accepted',
      storageKind: null,
      storageRef: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'artifact-1', generation: 3 }])
      .mockResolvedValueOnce([]);
    const updateMany = jest.fn();
    const prisma: Record<string, unknown> = {
      $queryRaw: query,
      workspace: { findUnique: jest.fn(async () => ({ maxArtifactBytes: 1024n })) },
      buildArtifact: {
        findUnique: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({ _sum: { sizeBytes: 0n } })),
        create: jest.fn(async () => accepted),
        updateMany,
      },
      deploymentOperation: { updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma));
    const store = {
      durable: true,
      put: jest.fn(async () => undefined),
      head: jest.fn(async () => ({ sizeBytes: 25 })),
      delete: jest.fn(async () => undefined),
    };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      {
        saveImageArchive: jest.fn(async (_imageRef: string, path: string) => {
          writeFileSync(path, 'verified-registry-archive');
        }),
      } as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        null,
        'a'.repeat(40),
      ),
    ).rejects.toThrow('Artifact execution lease was lost');

    expect(store.put).toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'available' }) }),
    );
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('rejects changed bytes for an already reserved immutable registry commit', async () => {
    const existing = {
      id: 'artifact-1',
      projectId: 'project-1',
      sourceProvider: 'gitea-oci',
      providerArtifactId: `project-1:${'a'.repeat(40)}`,
      providerRunId: '',
      commitSha: 'a'.repeat(40),
      name: 'initpad-image.tar',
      digest: '0'.repeat(64),
      sizeBytes: 25n,
      expiresAt: new Date(),
      status: 'failed',
      storageKind: null,
      storageRef: null,
      error: 'previous upload failed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma: Record<string, unknown> = {
      buildArtifact: { findUnique: jest.fn(async () => existing) },
    };
    prisma.$transaction = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma));
    const store = { durable: true, put: jest.fn(), delete: jest.fn() };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      {
        saveImageArchive: jest.fn(async (_imageRef: string, path: string) => {
          writeFileSync(path, 'verified-registry-archive');
        }),
      } as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        null,
        'a'.repeat(40),
      ),
    ).rejects.toThrow('Registry image bytes changed');
    expect(store.put).not.toHaveBeenCalled();
  });

  it('uses a concurrently repaired artifact instead of reopening its stale revision', async () => {
    const digest = createHash('sha256').update('verified-registry-archive').digest('hex');
    const stale = {
      id: 'artifact-1',
      projectId: 'project-1',
      sourceProvider: 'gitea-oci',
      providerArtifactId: `project-1:${'a'.repeat(40)}`,
      providerRunId: '',
      commitSha: 'a'.repeat(40),
      name: 'initpad-image.tar',
      digest,
      sizeBytes: 25n,
      expiresAt: new Date(),
      status: 'available',
      storageKind: 'object-store',
      storageRef: 'artifacts/stale.tar',
      error: null,
      ingestionGeneration: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const repaired = {
      ...stale,
      storageRef: 'artifacts/repaired.tar',
      ingestionGeneration: 2,
      updatedAt: new Date('2026-01-01T00:01:00Z'),
    };
    const findUnique = jest.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(repaired);
    const prisma: Record<string, unknown> = { buildArtifact: { findUnique } };
    prisma.$transaction = jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma));
    const store = {
      durable: true,
      head: jest.fn(async () => ({ sizeBytes: 1 })),
      put: jest.fn(),
      delete: jest.fn(async () => undefined),
    };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      {
        saveImageArchive: jest.fn(async (_imageRef: string, path: string) => {
          writeFileSync(path, 'verified-registry-archive');
        }),
      } as never,
    );

    await expect(
      lifecycle.captureRegistryArtifact(
        GITEA_REPOSITORY,
        { id: 'project-1', workspaceId: 'workspace-1' },
        null,
        'a'.repeat(40),
      ),
    ).resolves.toEqual(repaired);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith('artifacts/stale.tar');
  });
});
