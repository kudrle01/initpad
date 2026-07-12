import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports readiness when PostgreSQL responds', async () => {
    const prisma = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as never);
    await expect(controller.readiness()).resolves.toMatchObject({
      status: 'ready', dependencies: { database: 'ok' },
    });
  });

  it('returns 503 when PostgreSQL is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn(async () => { throw new Error('offline'); }) };
    const controller = new HealthController(prisma as never);
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
