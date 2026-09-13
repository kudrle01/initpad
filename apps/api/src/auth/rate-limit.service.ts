import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private nextCleanupAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Atomically consumes one fixed-window bucket shared by every API replica. */
  async consume(
    scope: string,
    dimension: 'ip' | 'subject',
    subject: string,
    limit: number,
    windowMs: number,
    now = new Date(),
  ): Promise<RateLimitDecision> {
    const windowStartedAtMs = Math.floor(now.getTime() / windowMs) * windowMs;
    const expiresAt = new Date(windowStartedAtMs + windowMs);
    const key = this.bucketKey(scope, dimension, subject, windowStartedAtMs);
    const bucket = await this.prisma.rateLimitBucket.upsert({
      where: { key },
      create: {
        key,
        scope,
        dimension,
        count: 1,
        windowStartedAt: new Date(windowStartedAtMs),
        expiresAt,
      },
      update: { count: { increment: 1 } },
      select: { count: true, expiresAt: true },
    });
    this.scheduleCleanup(now);
    return {
      allowed: bucket.count <= limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1_000),
      ),
    };
  }

  private bucketKey(
    scope: string,
    dimension: 'ip' | 'subject',
    subject: string,
    windowStartedAtMs: number,
  ): string {
    return createHmac('sha256', config.security.encryptionKey)
      .update(`${scope}\0${dimension}\0${windowStartedAtMs}\0${subject}`)
      .digest('hex');
  }

  private scheduleCleanup(now: Date): void {
    if (now.getTime() < this.nextCleanupAt) return;
    this.nextCleanupAt = now.getTime() + 5 * 60_000;
    void this.prisma.rateLimitBucket
      .deleteMany({ where: { expiresAt: { lt: now } } })
      .catch((error: unknown) => {
        this.logger.warn({
          event: 'rate_limit.cleanup_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
  }
}
