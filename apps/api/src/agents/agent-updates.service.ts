import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditEventsService } from '../audit/audit-events.service';
import { newCorrelationId } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReleaseCatalogService } from '../updates/release-catalog.service';
import { compareStableVersions, parseStableVersion } from '../updates/release-manifest';
import { AgentsService } from './agents.service';
import { agentVersionAtLeast, MIN_REMOTE_UPDATE_AGENT_VERSION } from './agent-version';
import type { CreateAgentUpdateDto } from './dto/agent-job.dto';
import type { AgentJobSummary } from './agent-jobs.service';

export interface AgentUpdateStatus {
  enabled: boolean;
  checkedAt: string | null;
  stale: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateMethod: 'none' | 'manual' | 'remote';
  image: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  error: string | null;
}

@Injectable()
export class AgentUpdatesService {
  constructor(
    private readonly agents: AgentsService,
    private readonly catalog: ReleaseCatalogService,
    private readonly prisma: PrismaService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  async status(targetId: string, userId: string): Promise<AgentUpdateStatus> {
    await this.agents.requireTargetAccess(targetId, userId, 'admin');
    const [agent, catalog] = await Promise.all([
      this.agents.getForTarget(targetId, userId),
      this.catalog.latestAgentRelease(),
    ]);
    const currentVersion = agent?.version ?? null;
    const latestVersion = catalog.release?.manifest.version ?? null;
    const updateAvailable = Boolean(
      currentVersion &&
      latestVersion &&
      parseStableVersion(currentVersion) &&
      compareStableVersions(latestVersion, currentVersion) > 0,
    );
    return {
      enabled: catalog.enabled,
      checkedAt: catalog.checkedAt,
      stale: catalog.stale,
      currentVersion,
      latestVersion,
      updateAvailable,
      updateMethod: !updateAvailable
        ? 'none'
        : agentVersionAtLeast(currentVersion, MIN_REMOTE_UPDATE_AGENT_VERSION)
          ? 'remote'
          : 'manual',
      image: catalog.release?.manifest.image.immutableReference ?? null,
      releaseUrl: catalog.release?.releaseUrl ?? null,
      publishedAt: catalog.release?.publishedAt ?? null,
      error: catalog.error,
    };
  }

  async requestUpdate(
    targetId: string,
    userId: string,
    dto: CreateAgentUpdateDto,
  ): Promise<AgentJobSummary> {
    const target = await this.agents.requireTargetAccess(targetId, userId, 'admin');
    if (target.managementState !== 'active') {
      throw new BadRequestException('Restore the target before updating its Agent');
    }
    const dedupeKey = `agent-update:${targetId}:${dto.requestId}`;
    const previous = await this.prisma.agentJob.findUnique({ where: { dedupeKey } });
    if (previous) return this.summary(previous);

    const status = await this.status(targetId, userId);
    if (!status.updateAvailable || !status.latestVersion) {
      throw new BadRequestException('No newer verified Agent release is available');
    }
    if (status.updateMethod !== 'remote') {
      throw new BadRequestException(
        `Agent ${MIN_REMOTE_UPDATE_AGENT_VERSION.join('.')} or newer is required for remote updates`,
      );
    }
    const catalog = await this.catalog.latestAgentRelease();
    const release = catalog.release;
    if (!release || release.manifest.version !== status.latestVersion || catalog.error) {
      throw new BadRequestException('The verified Agent release is not currently available');
    }

    const created = await this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.agentJob.findUnique({ where: { dedupeKey } });
        if (existing) return { row: existing, isNew: false };
        const active = await transaction.agentJob.findFirst({
          where: { targetId, status: { in: ['blocked', 'queued', 'leased'] } },
          select: { id: true, kind: true },
        });
        if (active) {
          throw new ConflictException(
            `Wait for the current ${active.kind} Agent job to finish before updating`,
          );
        }
        const row = await transaction.agentJob.create({
          data: {
            correlationId: newCorrelationId(),
            targetId,
            dedupeKey,
            kind: 'agent-update',
            protocolVersion: 1,
            payload: {
              version: release.manifest.version,
              manifestBase64: release.manifestBase64,
              bundle: release.bundle,
            },
            status: 'queued',
            progressStage: 'queued',
            message: `Waiting to update Agent to ${release.manifest.version}`,
          },
        });
        return { row, isNew: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!created.isNew) return this.summary(created.row);

    try {
      await this.auditEvents.record({
        workspaceId: target.workspaceId,
        actorUserId: userId,
        action: 'agent.update_requested',
        outcome: 'accepted',
        resourceType: 'agent',
        resourceId: created.row.id,
        resourceName: target.name,
        operation: { type: 'agent-job', id: created.row.id },
        details: {
          fromVersion: status.currentVersion ?? 'unknown',
          toVersion: release.manifest.version,
        },
      });
    } catch (error) {
      await this.prisma.agentJob.updateMany({
        where: { id: created.row.id, status: 'queued' },
        data: {
          status: 'cancelled',
          progressStage: 'cancelled',
          message: 'Update cancelled because its audit record could not be created',
          finishedAt: new Date(),
        },
      });
      throw error;
    }
    return this.summary(created.row);
  }

  private summary(row: {
    id: string;
    correlationId: string;
    kind: string;
    status: string;
    attempt: number;
    progressSequence: number;
    progressPercent: number;
    progressStage: string;
    message: string | null;
    resultCode: string | null;
    createdAt: Date;
    leasedAt: Date | null;
    leaseExpiresAt: Date | null;
    finishedAt: Date | null;
  }): AgentJobSummary {
    return {
      id: row.id,
      correlationId: row.correlationId,
      kind: row.kind,
      status: row.status,
      attempt: row.attempt,
      progressSequence: row.progressSequence,
      progressPercent: row.progressPercent,
      progressStage: row.progressStage,
      message: row.message,
      resultCode: row.resultCode,
      createdAt: row.createdAt.toISOString(),
      leasedAt: row.leasedAt?.toISOString() ?? null,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
