import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const EXECUTION_LEASE_MS = 90_000;
const EXECUTION_RENEW_MS = 30_000;

export const ARTIFACT_EXECUTION_LEGACY_GRACE_MS = EXECUTION_LEASE_MS;

export interface ArtifactExecutionIdentity {
  projectId: string;
  sourceProvider: string;
  providerArtifactId: string;
}

export interface ArtifactExecutionContext {
  id: string;
  generation: number;
  lost: Error | null;
  completed: boolean;
}

type ArtifactExecutionClaim = Pick<ArtifactExecutionContext, 'id' | 'generation'>;

/**
 * Renewable, generation-fenced ownership for one BuildArtifact publication.
 * Both downloaded GitHub artifacts and captured Gitea OCI images use this
 * boundary so a stale API replica can neither publish nor delete shared data.
 */
export class ProjectArtifactExecutionLease {
  private readonly instanceId = randomUUID();
  private readonly localExecutions = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    identity: ArtifactExecutionIdentity,
    task: (context: ArtifactExecutionContext) => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const localKey = `${identity.sourceProvider}:${identity.providerArtifactId}`;
    if (this.localExecutions.has(localKey)) return { acquired: false };
    const claim = await this.claim(identity);
    if (!claim) return { acquired: false };

    const context: ArtifactExecutionContext = { ...claim, lost: null, completed: false };
    this.localExecutions.add(localKey);
    const timer = setInterval(() => {
      void this.renew(context).catch((error) => {
        context.lost =
          error instanceof Error ? error : new ConflictException('Artifact execution lease lost');
      });
    }, EXECUTION_RENEW_MS);
    timer.unref();

    try {
      return { acquired: true, value: await task(context) };
    } finally {
      clearInterval(timer);
      this.localExecutions.delete(localKey);
      if (!context.completed) await this.release(context).catch(() => undefined);
    }
  }

  fence(context: ArtifactExecutionContext, projectId?: string) {
    return {
      id: context.id,
      ...(projectId ? { projectId } : {}),
      status: 'ingesting',
      ingestionOwner: this.instanceId,
      ingestionGeneration: context.generation,
    } as const;
  }

  async assert(context: ArtifactExecutionContext): Promise<void> {
    if (context.completed) return;
    if (context.lost) throw context.lost;
    await this.renew(context);
    const lost = context.lost as Error | null;
    if (lost) throw lost;
  }

  complete(context: ArtifactExecutionContext): void {
    context.completed = true;
  }

  private async claim(identity: ArtifactExecutionIdentity): Promise<ArtifactExecutionClaim | null> {
    const rows = await this.prisma.$queryRaw<ArtifactExecutionClaim[]>(Prisma.sql`
      UPDATE "BuildArtifact"
      SET
        "status" = 'ingesting',
        "error" = NULL,
        "ingestionOwner" = ${this.instanceId},
        "ingestionGeneration" = "ingestionGeneration" + 1,
        "ingestionLeaseExpiresAt" = CURRENT_TIMESTAMP
          + (${EXECUTION_LEASE_MS} * INTERVAL '1 millisecond')
      WHERE "sourceProvider" = ${identity.sourceProvider}
        AND "providerArtifactId" = ${identity.providerArtifactId}
        AND "projectId" = ${identity.projectId}
        AND "status" IN ('accepted', 'failed')
        AND "ingestionOwner" IS NULL
      RETURNING "id", "ingestionGeneration" AS "generation"
    `);
    return rows[0] ?? null;
  }

  private async renew(context: ArtifactExecutionContext): Promise<void> {
    if (context.completed || context.lost) {
      if (context.lost) throw context.lost;
      return;
    }
    const rows = await this.prisma.$queryRaw<ArtifactExecutionClaim[]>(Prisma.sql`
      UPDATE "BuildArtifact"
      SET
        "ingestionLeaseExpiresAt" = CURRENT_TIMESTAMP
          + (${EXECUTION_LEASE_MS} * INTERVAL '1 millisecond')
      WHERE "id" = ${context.id}
        AND "status" = 'ingesting'
        AND "ingestionOwner" = ${this.instanceId}
        AND "ingestionGeneration" = ${context.generation}
        AND "ingestionLeaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id", "ingestionGeneration" AS "generation"
    `);
    if (rows.length !== 1) {
      context.lost = new ConflictException('Artifact execution lease was lost');
      throw context.lost;
    }
  }

  private async release(context: ArtifactExecutionContext): Promise<void> {
    await this.prisma.buildArtifact.updateMany({
      where: this.fence(context),
      data: { ingestionOwner: null, ingestionLeaseExpiresAt: null },
    });
  }
}
