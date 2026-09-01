import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditEventsDto } from './dto/list-audit-events.dto';

export type AuditOutcome = 'succeeded' | 'failed';
export type AuditDetailValue = string | number | boolean;

export interface RecordAuditEvent {
  workspaceId: string;
  actorUserId: string;
  action: string;
  outcome?: AuditOutcome;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  details?: Record<string, AuditDetailValue>;
}

const IDENTIFIER = /^[a-z][a-z0-9_.-]*$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_-]*$/;
const SENSITIVE_DETAIL_KEY = /(password|secret|token|credential|authorization|private[_-]?key|access[_-]?key|config[_-]?value|logs?)/i;

function safeDetails(details?: Record<string, AuditDetailValue>): Prisma.InputJsonObject | undefined {
  if (!details) return undefined;
  const entries = Object.entries(details);
  if (entries.length > 20) throw new Error('Audit event details may contain at most 20 fields');

  const normalized: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of entries) {
    if (!/^[a-z][A-Za-z0-9_]{0,63}$/.test(key) || SENSITIVE_DETAIL_KEY.test(key)) {
      throw new Error(`Unsafe audit detail key '${key}'`);
    }
    if (typeof value === 'string' && value.length > 256) {
      throw new Error(`Audit detail '${key}' exceeds 256 characters`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Audit detail '${key}' must be finite`);
    }
    normalized[key] = value;
  }
  if (JSON.stringify(normalized).length > 4096) {
    throw new Error('Audit event details exceed 4096 bytes');
  }
  return normalized;
}

@Injectable()
export class AuditEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEvent): Promise<void> {
    if (!IDENTIFIER.test(input.action) || input.action.length > 80) {
      throw new Error(`Invalid audit action '${input.action}'`);
    }
    if (!RESOURCE_TYPE.test(input.resourceType) || input.resourceType.length > 40) {
      throw new Error(`Invalid audit resource type '${input.resourceType}'`);
    }
    if (input.resourceName && input.resourceName.length > 256) {
      throw new Error('Audit resource name exceeds 256 characters');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { username: true, name: true },
    });
    if (!actor) throw new Error(`Audit actor '${input.actorUserId}' does not exist`);

    await this.prisma.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        actorUsername: actor.username,
        actorDisplayName: actor.name,
        action: input.action,
        outcome: input.outcome ?? 'succeeded',
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        resourceName: input.resourceName ?? null,
        details: safeDetails(input.details),
      },
    });
  }

  async list(userId: string, requestedWorkspaceId: string | undefined, query: ListAuditEventsDto) {
    const workspaceId = await this.visibleWorkspace(userId, requestedWorkspaceId);
    if (query.cursor) {
      const cursor = await this.prisma.auditEvent.findFirst({
        where: { id: query.cursor, workspaceId },
        select: { id: true },
      });
      if (!cursor) throw new BadRequestException('Invalid audit cursor');
    }

    const where: Prisma.AuditEventWhereInput = {
      workspaceId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map((row) => ({
        id: row.id,
        actor: {
          userId: row.actorUserId,
          username: row.actorUsername,
          displayName: row.actorDisplayName,
        },
        action: row.action,
        outcome: row.outcome as AuditOutcome,
        resource: {
          type: row.resourceType,
          id: row.resourceId,
          name: row.resourceName,
        },
        details: row.details,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items.at(-1)!.id : null,
    };
  }

  private async visibleWorkspace(userId: string, requestedWorkspaceId?: string): Promise<string> {
    if (requestedWorkspaceId) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: requestedWorkspaceId, userId } },
        select: { workspaceId: true },
      });
      if (!membership) throw new NotFoundException('Workspace not found');
      return membership.workspaceId;
    }

    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    });
    if (!membership) throw new NotFoundException('Workspace not found');
    return membership.workspaceId;
  }
}
