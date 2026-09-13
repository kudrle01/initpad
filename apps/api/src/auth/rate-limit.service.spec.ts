import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  const upsert = jest.fn();
  const deleteMany = jest.fn(async () => ({ count: 0 }));
  const prisma = { rateLimitBucket: { upsert, deleteMany } };
  const service = new RateLimitService(prisma as never);
  const now = new Date('2026-09-13T12:03:45.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    (service as unknown as { nextCleanupAt: number }).nextCleanupAt = 0;
  });

  it('uses an opaque stable key and an atomic database increment', async () => {
    upsert.mockResolvedValue({ count: 1, expiresAt: new Date('2026-09-13T12:05:00.000Z') });

    const result = await service.consume(
      'auth.signin',
      'subject',
      'alice@example.test',
      10,
      300_000,
      now,
    );

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 75 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: expect.stringMatching(/^[a-f0-9]{64}$/) },
        create: expect.objectContaining({
          scope: 'auth.signin',
          dimension: 'subject',
          count: 1,
          windowStartedAt: new Date('2026-09-13T12:00:00.000Z'),
          expiresAt: new Date('2026-09-13T12:05:00.000Z'),
        }),
        update: { count: { increment: 1 } },
      }),
    );
    expect(JSON.stringify(upsert.mock.calls[0])).not.toContain('alice@example.test');
  });

  it('rejects the first count above the configured limit', async () => {
    upsert.mockResolvedValue({ count: 11, expiresAt: new Date('2026-09-13T12:05:00.000Z') });

    await expect(
      service.consume('auth.signin', 'subject', 'alice', 10, 300_000, now),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 75 });
  });

  it('changes the opaque key between fixed windows and schedules expired cleanup', async () => {
    upsert
      .mockResolvedValueOnce({ count: 1, expiresAt: new Date('2026-09-13T12:05:00.000Z') })
      .mockResolvedValueOnce({ count: 1, expiresAt: new Date('2026-09-13T12:10:00.000Z') });

    await service.consume('auth.signin', 'ip', '192.0.2.10', 30, 300_000, now);
    const firstKey = upsert.mock.calls[0][0].where.key as string;
    await Promise.resolve();
    expect(deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });

    (service as unknown as { nextCleanupAt: number }).nextCleanupAt = 0;
    await service.consume(
      'auth.signin',
      'ip',
      '192.0.2.10',
      30,
      300_000,
      new Date('2026-09-13T12:05:01.000Z'),
    );
    expect(upsert.mock.calls[1][0].where.key).not.toBe(firstKey);
  });
});
