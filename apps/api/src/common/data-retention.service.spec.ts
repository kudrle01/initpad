import { config } from '../config';
import { DataRetentionService } from './data-retention.service';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-09T12:00:00Z');

type Row = { id: string };

// One table: findMany honours `take`, deleteMany removes the listed ids.
function table(ids: string[]) {
  const remaining = [...ids];
  return {
    remaining,
    findMany: jest.fn(async ({ take }: { take: number }): Promise<Row[]> =>
      remaining.slice(0, take).map((id) => ({ id })),
    ),
    deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      const before = remaining.length;
      for (const id of where.id.in) remaining.splice(remaining.indexOf(id), 1);
      return { count: before - remaining.length };
    }),
  };
}

describe('DataRetentionService (ADR-150)', () => {
  const savedAuditDays = config.retention.auditDays;
  afterEach(() => {
    config.retention.auditDays = savedAuditDays;
  });

  function service(rows: { audit?: string[]; jobs?: string[] } = {}) {
    const prisma = {
      authToken: table(['t1']),
      emailOutbox: table(['m1', 'm2']),
      agentJob: table(rows.jobs ?? []),
      auditEvent: table(rows.audit ?? []),
    };
    return { prisma, retention: new DataRetentionService(prisma as never, {} as never) };
  }

  it('removes only finished history older than each retention window', async () => {
    config.retention.auditDays = 400;
    const { prisma, retention } = service({ audit: ['a1'], jobs: ['j1'] });

    await expect(retention.sweep(now)).resolves.toEqual({
      authTokens: 1,
      emailOutbox: 2,
      agentJobs: 1,
      auditEvents: 1,
    });

    const where = (mock: jest.Mock) => (mock.mock.calls[0] as [{ where: unknown }])[0].where;
    expect(where(prisma.authToken.findMany)).toEqual({
      OR: [
        { usedAt: { lt: new Date(now.getTime() - 7 * DAY) } },
        { expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } },
      ],
    });
    expect(where(prisma.emailOutbox.findMany)).toEqual({
      status: { in: ['sent', 'failed'] },
      updatedAt: { lt: new Date(now.getTime() - 30 * DAY) },
    });
    expect(where(prisma.agentJob.findMany)).toEqual({
      status: { in: ['succeeded', 'failed', 'cancelled'] },
      finishedAt: { lt: new Date(now.getTime() - 90 * DAY) },
    });
    expect(where(prisma.auditEvent.findMany)).toEqual({
      createdAt: { lt: new Date(now.getTime() - 400 * DAY) },
    });
  });

  it('keeps the audit when its retention is 0', async () => {
    config.retention.auditDays = 0;
    const { prisma, retention } = service({ audit: ['a1'] });
    await expect(retention.sweep(now)).resolves.toMatchObject({ auditEvents: 0 });
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('drains a backlog in bounded batches', async () => {
    const jobs = Array.from({ length: 12_000 }, (_, index) => `j${index}`);
    const { prisma, retention } = service({ jobs });
    // 20 batches of 500 per sweep; the rest waits for the next hour.
    await expect(retention.sweep(now)).resolves.toMatchObject({ agentJobs: 10_000 });
    expect(prisma.agentJob.remaining).toHaveLength(2_000);
    await expect(retention.sweep(now)).resolves.toMatchObject({ agentJobs: 2_000 });
  });
});
