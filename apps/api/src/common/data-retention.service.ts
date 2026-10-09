import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ControlPlaneLeaseService } from './control-plane-lease.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const LEASE_NAME = 'data-retention';
const LEASE_TTL_MS = 5 * 60_000;
// Bounded work per table and sweep; a large backlog drains over several hours.
const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

// How long finished rows stay before the sweep removes them (ADR-150).
export const RETENTION_DAYS = {
  // Single-use activation, reset and verification links after use or expiry.
  authTokens: 7,
  // Delivered or abandoned e-mails; the row keeps the recipient address.
  emailOutbox: 30,
  // Finished Agent jobs; deployment history keeps its own record.
  agentJobs: 90,
};

export type RetentionSummary = Record<
  'authTokens' | 'emailOutbox' | 'agentJobs' | 'auditEvents',
  number
>;

/**
 * Removes history that has no further use, so personal data and credentials
 * do not accumulate (ADR-150). One API replica runs the sweep hourly under a
 * control-plane lease.
 */
@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DataRetention');
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leases: ControlPlaneLeaseService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.trigger(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    this.trigger();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private trigger(): void {
    if (this.running) return;
    this.running = this.runAsLeader()
      .catch((error) =>
        this.logger.warn(`Data retention sweep skipped: ${(error as Error).message}`),
      )
      .finally(() => {
        this.running = undefined;
      });
  }

  private async runAsLeader(): Promise<void> {
    if (!(await this.leases.acquire(LEASE_NAME, LEASE_TTL_MS))) return;
    const summary = await this.sweep();
    if (Object.values(summary).some((count) => count > 0)) {
      this.logger.log({ event: 'retention.swept', ...summary });
    }
  }

  async sweep(now: Date = new Date()): Promise<RetentionSummary> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const authTokens = before(RETENTION_DAYS.authTokens);
    const emailOutbox = before(RETENTION_DAYS.emailOutbox);
    const agentJobs = before(RETENTION_DAYS.agentJobs);
    const auditDays = config.retention.auditDays;

    return {
      authTokens: await this.drain(
        (take) =>
          this.prisma.authToken.findMany({
            where: { OR: [{ usedAt: { lt: authTokens } }, { expiresAt: { lt: authTokens } }] },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.authToken.deleteMany({ where: { id: { in: ids } } }),
      ),
      emailOutbox: await this.drain(
        (take) =>
          this.prisma.emailOutbox.findMany({
            where: { status: { in: ['sent', 'failed'] }, updatedAt: { lt: emailOutbox } },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.emailOutbox.deleteMany({ where: { id: { in: ids } } }),
      ),
      agentJobs: await this.drain(
        (take) =>
          this.prisma.agentJob.findMany({
            where: {
              status: { in: ['succeeded', 'failed', 'cancelled'] },
              finishedAt: { lt: agentJobs },
            },
            select: { id: true },
            take,
          }),
        (ids) => this.prisma.agentJob.deleteMany({ where: { id: { in: ids } } }),
      ),
      // 0 keeps the audit forever.
      auditEvents:
        auditDays > 0
          ? await this.drain(
              (take) =>
                this.prisma.auditEvent.findMany({
                  where: { createdAt: { lt: before(auditDays) } },
                  select: { id: true },
                  take,
                }),
              (ids) => this.prisma.auditEvent.deleteMany({ where: { id: { in: ids } } }),
            )
          : 0,
    };
  }

  private async drain(
    find: (take: number) => Promise<Array<{ id: string }>>,
    remove: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let removed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const rows = await find(BATCH_SIZE);
      if (rows.length === 0) break;
      removed += (await remove(rows.map((row) => row.id))).count;
      if (rows.length < BATCH_SIZE) break;
    }
    return removed;
  }
}
