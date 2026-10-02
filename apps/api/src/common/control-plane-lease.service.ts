import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const MIN_TTL_MS = 15_000;
const MAX_TTL_MS = 5 * 60_000;
const LEASE_NAME = /^[a-z][a-z0-9.-]{0,63}$/;

export interface ControlPlaneLeaseClaim {
  generation: number;
  expiresAt: Date;
}

/**
 * Atomically elects one API process for a bounded background responsibility.
 * The database clock is authoritative, avoiding host clock skew across
 * replicas. Rows are intentionally retained after shutdown; failover occurs
 * only after the last proven lease expires.
 */
@Injectable()
export class ControlPlaneLeaseService {
  private readonly ownerId = randomUUID();

  constructor(private readonly prisma: PrismaService) {}

  async acquire(name: string, ttlMs: number): Promise<ControlPlaneLeaseClaim | null> {
    if (!LEASE_NAME.test(name)) throw new Error('Control-plane lease name is invalid');
    if (!Number.isInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new Error(`Control-plane lease TTL must be ${MIN_TTL_MS}-${MAX_TTL_MS} ms`);
    }

    const rows = await this.prisma.$queryRaw<ControlPlaneLeaseClaim[]>(Prisma.sql`
      INSERT INTO "ControlPlaneLease" (
        "name", "ownerId", "generation", "expiresAt", "updatedAt"
      )
      VALUES (
        ${name}, ${this.ownerId}, 1,
        CURRENT_TIMESTAMP + (${ttlMs} * INTERVAL '1 millisecond'),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("name") DO UPDATE SET
        "ownerId" = EXCLUDED."ownerId",
        "generation" = CASE
          WHEN "ControlPlaneLease"."ownerId" = EXCLUDED."ownerId"
            THEN "ControlPlaneLease"."generation"
          ELSE "ControlPlaneLease"."generation" + 1
        END,
        "expiresAt" = EXCLUDED."expiresAt",
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE
        "ControlPlaneLease"."ownerId" = EXCLUDED."ownerId"
        OR "ControlPlaneLease"."expiresAt" <= CURRENT_TIMESTAMP
      RETURNING "generation", "expiresAt"
    `);
    return rows[0] ?? null;
  }
}
