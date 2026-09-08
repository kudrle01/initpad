import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports readiness only when PostgreSQL and artifact storage respond', async () => {
    const prisma = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) };
    const artifactStore = { checkHealth: jest.fn(async () => undefined) };
    const controller = new HealthController(prisma as never, artifactStore as never);
    await expect(controller.readiness()).resolves.toMatchObject({
      status: 'ready', dependencies: { database: 'ok', artifactStore: 'ok' },
    });
  });

  it('returns 503 when PostgreSQL is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn(async () => { throw new Error('offline'); }) };
    const artifactStore = { checkHealth: jest.fn(async () => undefined) };
    const controller = new HealthController(prisma as never, artifactStore as never);
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns 503 without hiding a healthy database when artifact storage is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) };
    const artifactStore = {
      checkHealth: jest.fn(async () => { throw new Error('object storage offline'); }),
    };
    const controller = new HealthController(prisma as never, artifactStore as never);

    await expect(controller.readiness()).rejects.toMatchObject({
      response: {
        status: 'not-ready',
        dependencies: { database: 'ok', artifactStore: 'unavailable' },
      },
    });
  });
});
