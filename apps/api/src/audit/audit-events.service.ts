import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditEventsDto } from './dto/list-audit-events.dto';

export type AuditOutcome = 'accepted' | 'succeeded' | 'failed' | 'cancelled';
export type AuditDetailValue = string | number | boolean;
export type AuditOperationType = 'deployment' | 'provisioning';

export interface AuditOperationRef {
  type: AuditOperationType;
  id: string;
}

export interface RecordAuditEvent {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  outcome?: AuditOutcome;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  operation?: AuditOperationRef;
  details?: Record<string, AuditDetailValue>;
}

const IDENTIFIER = /^[a-z][a-z0-9_.-]*$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_-]*$/;
const SENSITIVE_DETAIL_KEY = /(password|secret|token|credential|authorization|private[_-]?key|access[_-]?key|config[_-]?value|logs?)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function deploymentAction(kind: string, stage: 'requested' | 'completed'): string {
  const operation = kind === 'promote'
    ? 'promotion'
    : kind === 'rollback'
      ? 'rollback'
      : kind === 'start'
        ? 'start'
        : kind === 'stop'
          ? 'stop'
          : kind === 'remove'
            ? 'teardown'
            : 'deployment';
  return `environment.${operation}_${stage}`;
}

function provisioningAction(kind: string, stage: 'requested' | 'completed'): string {
  const operation = kind === 'import' ? 'import' : 'creation';
  return `project.${operation}_${stage}`;
}

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
    if (input.operation && !UUID.test(input.operation.id)) {
      throw new Error(`Invalid audit operation id '${input.operation.id}'`);
    }

    const actor = input.actorUserId
      ? await this.prisma.user.findUnique({
          where: { id: input.actorUserId },
          select: { username: true, name: true },
        })
      : null;
    if (input.actorUserId && !actor) {
      throw new Error(`Audit actor '${input.actorUserId}' does not exist`);
    }

    await this.createOnce({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      actorUsername: actor?.username ?? 'initpad',
      actorDisplayName: actor ? actor.name : 'InitPad system',
      action: input.action,
      outcome: input.outcome ?? 'succeeded',
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      resourceName: input.resourceName ?? null,
      operationType: input.operation?.type ?? null,
      operationId: input.operation?.id ?? null,
      details: safeDetails(input.details),
    });
  }

  async recordOperationResult(type: AuditOperationType, operationId: string): Promise<void> {
    if (!UUID.test(operationId)) throw new Error(`Invalid audit operation id '${operationId}'`);
    if (type === 'deployment') {
      const operation = await this.prisma.deploymentOperation.findUnique({
        where: { id: operationId },
        select: {
          id: true,
          kind: true,
          status: true,
          environment: {
            select: {
              name: true,
              project: { select: { id: true, name: true, workspaceId: true } },
            },
          },
        },
      });
      if (!operation || !['succeeded', 'failed', 'cancelled'].includes(operation.status)) return;
      await this.recordTerminal({
        type,
        operationId,
        workspaceId: operation.environment.project.workspaceId,
        action: deploymentAction(operation.kind, 'completed'),
        outcome: operation.status as Exclude<AuditOutcome, 'accepted'>,
        resourceType: 'project',
        resourceId: operation.environment.project.id,
        resourceName: operation.environment.project.name,
        details: {
          environment: operation.environment.name,
          kind: operation.kind,
        },
      });
      return;
    }

    const operation = await this.prisma.provisioningOperation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        projectName: true,
        kind: true,
        status: true,
        attempt: true,
      },
    });
    if (!operation || !['succeeded', 'failed', 'interrupted'].includes(operation.status)) return;
    await this.recordTerminal({
      type,
      operationId,
      workspaceId: operation.workspaceId,
      action: provisioningAction(operation.kind, 'completed'),
      outcome: operation.status === 'succeeded' ? 'succeeded' : 'failed',
      resourceType: 'project',
      resourceId: operation.projectId,
      resourceName: operation.projectName,
      details: { kind: operation.kind, attempt: operation.attempt },
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
    const deploymentIds = items
      .filter((row) => row.operationType === 'deployment' && row.operationId)
      .map((row) => row.operationId!);
    const provisioningIds = items
      .filter((row) => row.operationType === 'provisioning' && row.operationId)
      .map((row) => row.operationId!);
    const [deployments, provisioning] = await Promise.all([
      deploymentIds.length
        ? this.prisma.deploymentOperation.findMany({
            where: { id: { in: deploymentIds } },
            select: {
              id: true,
              kind: true,
              status: true,
              phase: true,
              environment: { select: { projectId: true } },
            },
          })
        : [],
      provisioningIds.length
        ? this.prisma.provisioningOperation.findMany({
            where: { id: { in: provisioningIds } },
            select: { id: true, kind: true, status: true, step: true, projectId: true },
          })
        : [],
    ]);
    const operationState = new Map<string, {
      kind: string;
      status: string;
      phase: string | null;
      projectId: string | null;
    }>([
      ...deployments.map((operation) => [
        `deployment:${operation.id}`,
        {
          kind: operation.kind,
          status: operation.status,
          phase: operation.phase,
          projectId: operation.environment.projectId,
        },
      ] as const),
      ...provisioning.map((operation) => [
        `provisioning:${operation.id}`,
        {
          kind: operation.kind,
          status: operation.status,
          phase: operation.step,
          projectId: operation.projectId,
        },
      ] as const),
    ]);
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
        operation: row.operationType && row.operationId
          ? {
              type: row.operationType as AuditOperationType,
              id: row.operationId,
              ...(operationState.get(`${row.operationType}:${row.operationId}`) ?? {
                kind: 'unknown',
                status: 'removed',
                phase: null,
                projectId: row.resourceId,
              }),
            }
          : null,
        details: row.details,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items.at(-1)!.id : null,
    };
  }

  private async recordTerminal(input: {
    type: AuditOperationType;
    operationId: string;
    workspaceId: string;
    action: string;
    outcome: Exclude<AuditOutcome, 'accepted'>;
    resourceType: string;
    resourceId: string | null;
    resourceName: string;
    details: Record<string, AuditDetailValue>;
  }): Promise<void> {
    const request = await this.prisma.auditEvent.findFirst({
      where: {
        workspaceId: input.workspaceId,
        operationType: input.type,
        operationId: input.operationId,
        outcome: 'accepted',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        actorUserId: true,
        actorUsername: true,
        actorDisplayName: true,
      },
    });
    await this.createOnce({
      workspaceId: input.workspaceId,
      actorUserId: request?.actorUserId ?? null,
      actorUsername: request?.actorUsername ?? 'initpad',
      actorDisplayName: request ? request.actorDisplayName : 'InitPad system',
      action: input.action,
      outcome: input.outcome,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceName: input.resourceName,
      operationType: input.type,
      operationId: input.operationId,
      details: safeDetails(input.details),
    });
  }

  private async createOnce(data: Prisma.AuditEventUncheckedCreateInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({ data });
    } catch (error) {
      if (data.operationType && data.operationId && uniqueViolation(error)) return;
      throw error;
    }
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

export const auditOperationAction = {
  deployment: deploymentAction,
  provisioning: provisioningAction,
};
