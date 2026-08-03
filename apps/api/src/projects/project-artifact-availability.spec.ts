import { createHash } from 'crypto';
import { existsSync, writeFileSync } from 'fs';
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
