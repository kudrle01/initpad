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

describe('ProjectArtifactLifecycle registry capture for Agent delivery', () => {
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
      head: jest.fn(async () => null),
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
    const prisma = {
      buildArtifact: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => created),
      },
      deploymentOperation: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const lifecycle = new ProjectArtifactLifecycle(
      prisma as never,
      store as never,
      deployment as never,
    );

    await expect(lifecycle.captureRegistryArtifact(
      GITEA_REPOSITORY,
      { id: 'project-1', workspaceId: 'workspace-1' },
      'operation-1',
      'a'.repeat(40),
    )).resolves.toBe(created);

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
    expect(prisma.deploymentOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'operation-1', status: 'running', environment: { projectId: 'project-1' } },
      data: { buildArtifactId: 'artifact-1' },
    });
  });

  it('refuses remote delivery when storage is only process memory', async () => {
    const lifecycle = new ProjectArtifactLifecycle(
      {} as never,
      { durable: false } as never,
      { saveImageArchive: jest.fn() } as never,
    );

    await expect(lifecycle.captureRegistryArtifact(
      GITEA_REPOSITORY,
      { id: 'project-1', workspaceId: 'workspace-1' },
      'operation-1',
      'a'.repeat(40),
    )).rejects.toThrow(/durable artifact storage/);
  });
});
