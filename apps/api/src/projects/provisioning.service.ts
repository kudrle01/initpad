import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type ProvisioningKind = 'create' | 'import';
export type ProvisioningStep = 'validate' | 'repository' | 'ci' | 'done';
export type ProvisioningEffectKind = 'repository' | 'collaborator' | 'secrets' | 'project';

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RETRY_SAFE_EFFECTS = new Set(['planned', 'compensated']);
const CLEANUP_EFFECTS = new Set([
  'applying',
  'applied',
  'failed',
  'compensation_failed',
  'reconciliation_required',
]);

export interface ProvisioningStartOptions {
  requestedById: string;
  request: Prisma.InputJsonValue;
  retryOfId?: string;
  attempt?: number;
}

export interface ProvisioningEffectView {
  key: string;
  kind: string;
  status: string;
  metadata: unknown;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
  compensatedAt: string | null;
}

export interface ProvisioningView {
  id: string;
  kind: string;
  status: string;
  step: string;
  message: string | null;
  projectId: string | null;
  projectName: string;
  attempt: number;
  retryOfId: string | null;
  canRetry: boolean;
  needsCleanup: boolean;
  createdAt: string;
  finishedAt: string | null;
  effects: ProvisioningEffectView[];
}

export interface ProvisioningRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string;
  kind: string;
  status: string;
  requestedById: string | null;
  request: unknown;
  retryOfId: string | null;
  attempt: number;
  effects: EffectRow[];
}

export type EffectRow = {
  key: string;
  kind: string;
  status: string;
  metadata: unknown;
  error: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  compensatedAt: Date | null;
};

type Row = ProvisioningRecord & {
  step: string;
  message: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/**
 * Persistent provisioning audit plus a write-ahead effect journal. Planning an
 * effect and moving it to `applying` are deliberately strict: an external
 * mutation must not start if its recovery intent cannot be persisted.
 *
 * A process-scoped lease prevents another API instance from declaring a live
 * operation interrupted. An expired operation is never blindly retried: its
 * `applying` effects become `reconciliation_required` until cleanup proves the
 * external state safe.
 */
@Injectable()
export class ProvisioningService implements OnModuleInit {
  private readonly instanceId = randomUUID();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileStale();
  }

  async start(
    workspaceId: string,
    projectName: string,
    kind: ProvisioningKind,
    options?: ProvisioningStartOptions,
  ): Promise<string> {
    const data: Prisma.ProvisioningOperationUncheckedCreateInput = {
      workspaceId,
      projectName,
      kind,
      status: 'running',
      step: 'validate',
      leaseOwner: this.instanceId,
      leaseExpiresAt: this.leaseExpiry(),
      ...(options
        ? {
            requestedById: options.requestedById,
            request: options.request,
            retryOfId: options.retryOfId,
            attempt: options.attempt ?? 1,
          }
        : {}),
    };
    if (!options?.retryOfId) {
      return (
        await this.prisma.provisioningOperation.create({ data, select: { id: true } })
      ).id;
    }
    return this.prisma.$transaction(async (tx) => {
      const op = await tx.provisioningOperation.create({ data, select: { id: true } });
      const previous = await tx.provisioningOperation.updateMany({
        where: { id: options.retryOfId, status: 'retrying', leaseOwner: this.instanceId },
        data: {
          status: 'retried',
          message: 'A newer attempt has been started',
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (previous.count !== 1) throw new ConflictException('Retry ownership was lost');
      return op.id;
    });
  }

  async bindProject(id: string, projectId: string): Promise<void> {
    await this.prisma.provisioningOperation.update({ where: { id }, data: { projectId } });
  }

  async unbindProject(id: string): Promise<void> {
    await this.prisma.provisioningOperation.update({ where: { id }, data: { projectId: null } });
  }

  async planEffect(
    operationId: string,
    key: string,
    kind: ProvisioningEffectKind,
    metadata?: Record<string, string | null>,
  ): Promise<void> {
    await this.prisma.provisioningEffect.create({
      data: { operationId, key, kind, status: 'planned', ...(metadata ? { metadata } : {}) },
    });
  }

  async beginEffect(operationId: string, key: string): Promise<void> {
    await this.renewLease(operationId);
    await this.transitionEffect(operationId, key, ['planned'], { status: 'applying', error: null });
  }

  async completeEffect(
    operationId: string,
    key: string,
    metadata?: Record<string, string | null>,
  ): Promise<void> {
    await this.transitionEffect(operationId, key, ['applying'], {
      status: 'applied',
      appliedAt: new Date(),
      ...(metadata ? { metadata } : {}),
    });
    await this.renewLease(operationId);
  }

  async failEffect(operationId: string, key: string, error: string): Promise<void> {
    await this.transitionEffect(operationId, key, ['planned', 'applying'], {
      status: 'failed',
      error: error.slice(0, 500),
    });
  }

  async compensateEffect(operationId: string, key: string): Promise<void> {
    await this.transitionEffect(
      operationId,
      key,
      ['planned', 'applying', 'applied', 'failed', 'compensation_failed', 'reconciliation_required'],
      { status: 'compensated', compensatedAt: new Date(), error: null },
    );
  }

  async compensationFailed(operationId: string, key: string, error: string): Promise<void> {
    await this.transitionEffect(
      operationId,
      key,
      ['applying', 'applied', 'failed', 'compensation_failed', 'reconciliation_required'],
      { status: 'compensation_failed', error: error.slice(0, 500) },
    );
  }

  private async transitionEffect(
    operationId: string,
    key: string,
    from: string[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const changed = await this.prisma.provisioningEffect.updateMany({
      where: { operationId, key, status: { in: from } },
      data,
    });
    if (changed.count !== 1) {
      throw new Error(`Provisioning effect '${key}' is not in the expected state`);
    }
  }

  async step(id: string, step: ProvisioningStep): Promise<void> {
    await this.prisma.provisioningOperation
      .update({
        where: { id },
        data: { step, leaseExpiresAt: this.leaseExpiry() },
      })
      .catch(() => undefined);
  }

  async succeed(id: string, projectId?: string): Promise<void> {
    await this.prisma.provisioningOperation
      .update({
        where: { id },
        data: {
          status: 'succeeded',
          step: 'done',
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(projectId ? { projectId } : {}),
        },
      })
      .catch(() => undefined);
  }

  async fail(id: string, message: string): Promise<void> {
    await this.prisma.provisioningOperation
      .update({
        where: { id },
        data: {
          status: 'failed',
          message: message.slice(0, 500),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
      .catch(() => undefined);
  }

  async latestForProject(projectId: string): Promise<ProvisioningView | null> {
    await this.reconcileStale();
    const op = await this.prisma.provisioningOperation.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { effects: { orderBy: { createdAt: 'asc' } } },
    });
    return op ? this.toView(op, null) : null;
  }

  async listWorkspace(workspaceId: string, currentUserId: string): Promise<ProvisioningView[]> {
    await this.reconcileStale();
    const rows = await this.prisma.provisioningOperation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { effects: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((row) => this.toView(row, currentUserId));
  }

  async record(id: string): Promise<ProvisioningRecord> {
    await this.reconcileStale();
    const operation = await this.prisma.provisioningOperation.findUnique({
      where: { id },
      include: { effects: { orderBy: { createdAt: 'asc' } } },
    });
    if (!operation) throw new NotFoundException(`Provisioning operation '${id}' not found`);
    return operation;
  }

  async claimRetry(id: string): Promise<void> {
    const changed = await this.prisma.provisioningOperation.updateMany({
      where: { id, status: { in: ['failed', 'interrupted'] } },
      data: {
        status: 'retrying',
        message: 'Retry requested',
        leaseOwner: this.instanceId,
        leaseExpiresAt: this.leaseExpiry(),
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException('This provisioning operation is no longer retryable');
    }
  }

  async releaseRetry(id: string): Promise<void> {
    await this.prisma.provisioningOperation.updateMany({
      where: { id, status: 'retrying', leaseOwner: this.instanceId },
      data: {
        status: 'failed',
        message: 'Retry could not be started',
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  async cleanupFinished(id: string): Promise<void> {
    await this.prisma.provisioningOperation.update({
      where: { id },
      data: {
        status: 'failed',
        message: 'Cleanup completed; this operation is safe to retry',
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  async claimCleanup(id: string): Promise<void> {
    const changed = await this.prisma.provisioningOperation.updateMany({
      where: { id, status: { in: ['failed', 'interrupted'] } },
      data: {
        status: 'cleaning',
        message: 'Provisioning cleanup is running',
        leaseOwner: this.instanceId,
        leaseExpiresAt: this.leaseExpiry(),
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException('This provisioning cleanup is already running');
    }
  }

  async releaseCleanup(id: string, message: string): Promise<void> {
    await this.prisma.provisioningOperation.updateMany({
      where: { id, status: 'cleaning', leaseOwner: this.instanceId },
      data: {
        status: 'failed',
        message: message.slice(0, 500),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  isRetryable(operation: ProvisioningRecord, currentUserId: string): boolean {
    return (
      ['failed', 'interrupted'].includes(operation.status) &&
      operation.requestedById === currentUserId &&
      operation.request != null &&
      operation.attempt < MAX_ATTEMPTS &&
      operation.effects.every((effect) => RETRY_SAFE_EFFECTS.has(effect.status))
    );
  }

  needsCleanup(operation: Pick<ProvisioningRecord, 'status' | 'effects'>): boolean {
    return (
      ['failed', 'interrupted'].includes(operation.status) &&
      operation.effects.some((effect) => CLEANUP_EFFECTS.has(effect.status))
    );
  }

  async reconcileStale(): Promise<number> {
    const now = new Date();
    const legacyCutoff = new Date(now.getTime() - LEASE_MS);
    const stale = await this.prisma.provisioningOperation.findMany({
      where: {
        status: { in: ['running', 'cleaning', 'retrying'] },
        OR: [
          { leaseExpiresAt: { lt: now } },
          { leaseExpiresAt: null, createdAt: { lt: legacyCutoff } },
        ],
      },
      select: { id: true },
    });
    let recovered = 0;
    for (const operation of stale) {
      const claimed = await this.prisma.provisioningOperation.updateMany({
        where: {
          id: operation.id,
          status: { in: ['running', 'cleaning', 'retrying'] },
          OR: [
            { leaseExpiresAt: { lt: now } },
            { leaseExpiresAt: null, createdAt: { lt: legacyCutoff } },
          ],
        },
        data: {
          status: 'interrupted',
          message: 'The API process stopped before provisioning completed; reconciliation is required',
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (claimed.count !== 1) continue;
      recovered += 1;
      await this.prisma.provisioningEffect.updateMany({
        where: { operationId: operation.id, status: 'applying' },
        data: {
          status: 'reconciliation_required',
          error: 'The process stopped while this external effect may have been applied',
        },
      });
    }
    return recovered;
  }

  private async renewLease(id: string): Promise<void> {
    const renewed = await this.prisma.provisioningOperation.updateMany({
      where: { id, status: 'running', leaseOwner: this.instanceId },
      data: { leaseExpiresAt: this.leaseExpiry() },
    });
    if (renewed.count !== 1) throw new ConflictException('Provisioning lease was lost');
  }

  private leaseExpiry(): Date {
    return new Date(Date.now() + LEASE_MS);
  }

  private toView(op: Row, currentUserId: string | null): ProvisioningView {
    return {
      id: op.id,
      kind: op.kind,
      status: op.status,
      step: op.step,
      message: op.message,
      projectId: op.projectId,
      projectName: op.projectName,
      attempt: op.attempt,
      retryOfId: op.retryOfId,
      canRetry: currentUserId ? this.isRetryable(op, currentUserId) : false,
      needsCleanup: this.needsCleanup(op),
      createdAt: op.createdAt.toISOString(),
      finishedAt: op.finishedAt ? op.finishedAt.toISOString() : null,
      effects: op.effects.map((effect) => ({
        key: effect.key,
        kind: effect.kind,
        status: effect.status,
        metadata: effect.metadata,
        error: effect.error,
        createdAt: effect.createdAt.toISOString(),
        appliedAt: effect.appliedAt ? effect.appliedAt.toISOString() : null,
        compensatedAt: effect.compensatedAt ? effect.compensatedAt.toISOString() : null,
      })),
    };
  }
}
