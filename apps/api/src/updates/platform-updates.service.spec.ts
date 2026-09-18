import { config } from '../config';
import { PlatformUpdatesService } from './platform-updates.service';

const requestId = '3f04ebec-3299-4ce5-bd02-cf390ca413e9';
const operationId = '8617bbb8-896d-46bb-9db7-afdc081b2b91';
const originalEdition = config.edition;
const originalUpdates = { ...config.updates };

function supervisorOperation(status = 'accepted') {
  return {
    id: operationId,
    requestId,
    fromVersion: '0.2.0',
    toVersion: '0.3.0',
    status,
    stage: status,
    message: 'Update accepted',
    startedAt: '2026-09-16T12:00:00.000Z',
    finishedAt: null,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '72df993e-e62a-4daf-99a6-4abcb157e850',
    requestId,
    supervisorOperationId: operationId,
    requestedById: 'admin-id',
    requestedByUsername: 'admin',
    requestedByDisplayName: 'Administrator',
    fromVersion: '0.2.0',
    toVersion: '0.3.0',
    status: 'accepted',
    stage: 'accepted',
    message: 'Update accepted',
    startedAt: new Date('2026-09-16T12:00:00.000Z'),
    finishedAt: null,
    createdAt: new Date('2026-09-16T12:00:00.000Z'),
    updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    ...overrides,
  };
}

function catalog() {
  return {
    enabled: true,
    checkedAt: '2026-09-16T11:59:00.000Z',
    stale: false,
    error: null,
    release: {
      manifest: { version: '0.3.0' },
      manifestBase64: 'e30=',
      bundle: { mediaType: 'bundle' },
      releaseUrl: 'https://github.com/kudrle01/initpad/releases/tag/initpad-v0.3.0',
      publishedAt: '2026-09-16T11:00:00.000Z',
      verifiedAt: '2026-09-16T11:59:00.000Z',
    },
  };
}

describe('PlatformUpdatesService', () => {
  beforeEach(() => {
    config.edition = 'self-hosted';
    Object.assign(config.updates, { enabled: true, platformVersion: '0.2.0' });
  });

  afterAll(() => {
    config.edition = originalEdition;
    Object.assign(config.updates, originalUpdates);
  });

  it('offers only a newer verified release while the Supervisor is online', async () => {
    const prisma = {
      platformUpdateOperation: {
        findMany: jest.fn(async () => []),
      },
    };
    const releaseCatalog = { latest: jest.fn(async () => catalog()) };
    const supervisor = {
      configured: true,
      status: jest.fn(async () => ({
        schemaVersion: 1,
        currentVersion: '0.2.0',
        currentImages: null,
        operation: null,
      })),
    };
    const service = new PlatformUpdatesService(
      prisma as never,
      releaseCatalog as never,
      supervisor as never,
    );

    await expect(service.status()).resolves.toMatchObject({
      currentVersion: '0.2.0',
      latestVersion: '0.3.0',
      updateAvailable: true,
      canInstall: true,
      supervisorOnline: true,
    });
  });

  it('does not offer a second install while the Supervisor is already updating', async () => {
    const prisma = {
      platformUpdateOperation: {
        findUnique: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
    };
    const releaseCatalog = { latest: jest.fn(async () => catalog()) };
    const supervisor = {
      configured: true,
      status: jest.fn(async () => ({
        schemaVersion: 1,
        currentVersion: '0.2.0',
        currentImages: null,
        operation: supervisorOperation('running'),
      })),
    };
    const service = new PlatformUpdatesService(
      prisma as never,
      releaseCatalog as never,
      supervisor as never,
    );

    await expect(service.status()).resolves.toMatchObject({ canInstall: false });
  });

  it('records the requesting administrator before sending the signed payload', async () => {
    const create = jest.fn(async () => row({ supervisorOperationId: null, status: 'requesting' }));
    const update = jest.fn(async () => row());
    const prisma = {
      platformUpdateOperation: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async () => null),
        create,
        update,
      },
      user: {
        findUnique: jest.fn(async () => ({ username: 'admin', name: 'Administrator' })),
      },
    };
    const releaseCatalog = { latest: jest.fn(async () => catalog()) };
    const supervisor = {
      configured: true,
      status: jest.fn(async () => ({
        schemaVersion: 1,
        currentVersion: '0.2.0',
        currentImages: null,
        operation: null,
      })),
      update: jest.fn(async () => supervisorOperation()),
    };
    const service = new PlatformUpdatesService(
      prisma as never,
      releaseCatalog as never,
      supervisor as never,
    );

    await expect(service.request('admin-id', requestId)).resolves.toMatchObject({
      requestId,
      status: 'accepted',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestedByUsername: 'admin', status: 'requesting' }),
      }),
    );
    expect(supervisor.update).toHaveBeenCalledWith(requestId, {
      version: '0.3.0',
      manifestBase64: 'e30=',
      bundle: { mediaType: 'bundle' },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId },
        data: expect.objectContaining({ supervisorOperationId: operationId, status: 'accepted' }),
      }),
    );
  });
});
