import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditEventsService, auditOperationAction } from '../audit/audit-events.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  serializableCapacityTransaction,
  WorkspaceCapacityService,
} from '../workspaces/workspace-capacity.service';

export type ProvisioningKind = 'create' | 'import';
export type ProvisioningStep = 'validate' | 'repository' | 'ci' | 'done';
export type ProvisioningEffectKind = 'repository' | 'collaborator' | 'secrets' | 'project';

const LEASE_MS = 5 * 60 * 1000;
// Renewal well inside the lease, so one missed tick never expires a live
// operation.
export const LEASE_RENEW_MS = 60 * 1000;
// Read paths reconcile at most this often per process.
const RECONCILE_INTERVAL_MS = 30 * 1000;
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
  dismissedAt: string | null;
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
  dismissedAt?: Date | null;
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
  private readonly logger = new Logger(ProvisioningService.name);
  private readonly capacity: WorkspaceCapacityService;
  // Operations this process is executing right now. reconcileStale never
  // interrupts them, even if a renewal was delayed past the lease.
  private readonly localOperations = new Set<string>();
  private lastReconcileAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AuditEventsService)
    private readonly auditEvents?: Pick<AuditEventsService, 'record' | 'recordOperationResult'>,
  ) {
    this.capacity = new WorkspaceCapacityService(prisma);
  }

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
    let operationId: string;
    if (!options?.retryOfId) {
      operationId = await serializableCapacityTransaction(this.prisma, async (tx) => {
        await this.assertNotInProgress(tx, workspaceId, projectName, kind);
        await this.capacity.assertAvailable(workspaceId, 'concurrentOperations', 1, tx);
        return (await tx.provisioningOperation.create({ data, select: { id: true } })).id;
      });
    } else {
      operationId = await serializableCapacityTransaction(this.prisma, async (tx) => {
        await this.assertNotInProgress(tx, workspaceId, projectName, kind);
        await this.capacity.assertAvailable(
          workspaceId,
          'concurrentOperations',
          1,
          tx,
          options.retryOfId,
        );
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
    try {
      await this.auditEvents?.record({
        workspaceId,
        actorUserId: options?.requestedById,
        action: auditOperationAction.provisioning(kind, 'requested'),
        outcome: 'accepted',
        resourceType: 'project',
        resourceName: projectName,
        operation: { type: 'provisioning', id: operationId },
        details: { kind, attempt: options?.attempt ?? 1 },
      });
    } catch (error) {
      await this.prisma.provisioningOperation
        .update({
          where: { id: operationId },
          data: {
            status: 'failed',
            message: 'Provisioning could not be recorded in the audit log',
            finishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => undefined);
      throw error;
    }
    return operationId;
  }

  /**
   * Idempotent name reservation: a second create of the same name (or import
   * of the same repository) while the first one still holds a live lease is
   * refused before it can touch the SCM or the shared checkout.
   */
  private async assertNotInProgress(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectName: string,
    kind: ProvisioningKind,
  ): Promise<void> {
    const running = await tx.provisioningOperation.findFirst({
      where: {
        workspaceId,
        kind,
        status: 'running',
        leaseExpiresAt: { gt: new Date() },
        OR:
          kind === 'import'
            ? [{ projectName }, { request: { path: ['repositoryId'], equals: projectName } }]
            : [{ projectName }],
      },
      select: { projectName: true },
    });
    if (!running) return;
    throw new ConflictException(
      kind === 'import'
        ? `Repository '${running.projectName}' is already being imported. Wait for that import to finish.`
        : `Project '${projectName}' is already being created. Wait for that request to finish.`,
    );
  }

  /**
   * Keeps the lease of a running create/import alive for its whole duration,
   * including long SCM calls between journal steps. Returns the stop function.
   */
  holdLease(id: string): () => void {
    this.localOperations.add(id);
    const timer = setInterval(() => {
      void this.renewLease(id).catch((error) => {
        this.logger.warn(
          `Provisioning lease renewal failed for ${id}: ${(error as Error).message}`,
        );
      });
    }, LEASE_RENEW_MS);
    timer.unref();
    return () => {
      clearInterval(timer);
      this.localOperations.delete(id);
    };
  }

  /** Shows the repository name instead of its opaque id once it is known. */
  async rename(id: string, projectName: string): Promise<void> {
    await this.prisma.provisioningOperation
      .updateMany({
        where: { id, status: 'running', leaseOwner: this.instanceId },
        data: { projectName },
      })
      .catch(() => undefined);
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
      [
        'planned',
        'applying',
        'applied',
        'failed',
        'compensation_failed',
        'reconciliation_required',
      ],
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

  // step/succeed/fail are fenced by the lease owner: once another process
  // declared the operation interrupted, this process must not overwrite it.
  async step(id: string, step: ProvisioningStep): Promise<void> {
    await this.prisma.provisioningOperation
      .updateMany({
        where: { id, status: 'running', leaseOwner: this.instanceId },
        data: { step, leaseExpiresAt: this.leaseExpiry() },
      })
      .catch(() => undefined);
  }

  async succeed(id: string, projectId?: string): Promise<void> {
    const updated = await this.prisma.provisioningOperation
      .updateMany({
        where: { id, status: 'running', leaseOwner: this.instanceId },
        data: {
          status: 'succeeded',
          step: 'done',
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(projectId ? { projectId } : {}),
        },
      })
      .then((result) => result.count === 1)
      .catch(() => false);
    if (updated) await this.recordResultSafely(id);
    else this.logger.warn(`Provisioning ${id} finished after its lease was lost`);
  }

  async fail(id: string, message: string): Promise<void> {
    const updated = await this.prisma.provisioningOperation
      .updateMany({
        where: { id, status: 'running', leaseOwner: this.instanceId },
        data: {
          status: 'failed',
          message: message.slice(0, 500),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
      .then((result) => result.count === 1)
      .catch(() => false);
    if (updated) await this.recordResultSafely(id);
    else this.logger.warn(`Provisioning ${id} failed after its lease was lost: ${message}`);
  }

  async latestForProject(projectId: string): Promise<ProvisioningView | null> {
    await this.reconcileStaleThrottled();
    const op = await this.prisma.provisioningOperation.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { effects: { orderBy: { createdAt: 'asc' } } },
    });
    return op ? this.toView(op, null) : null;
  }

  async listWorkspace(workspaceId: string, currentUserId: string): Promise<ProvisioningView[]> {
    await this.reconcileStaleThrottled();
    const rows = await this.prisma.provisioningOperation.findMany({
      where: { workspaceId, dismissedAt: null },
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

  /**
   * Acknowledge a finished failure so it leaves the workspace overview. The
   * operation and its effect journal stay intact for audit and diagnostics.
   */
  async dismiss(operation: ProvisioningRecord, userId: string): Promise<void> {
    const changed = await this.prisma.provisioningOperation.updateMany({
      where: { id: operation.id, status: { in: ['failed', 'interrupted'] }, dismissedAt: null },
      data: { dismissedAt: new Date(), dismissedById: userId },
    });
    if (changed.count !== 1) {
      throw new ConflictException('Only a failed provisioning operation can be dismissed');
    }
    try {
      await this.auditEvents?.record({
        workspaceId: operation.workspaceId,
        actorUserId: userId,
        action: 'project.provisioning_dismissed',
        resourceType: 'project',
        resourceId: operation.projectId,
        resourceName: operation.projectName,
        details: {
          kind: operation.kind,
          attempt: operation.attempt,
          cleanupPending: this.needsCleanup(operation),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Provisioning dismissal audit failed for ${operation.id}: ${(error as Error).message}`,
      );
    }
  }

  isRetryable(operation: ProvisioningRecord, currentUserId: string): boolean {
    return this.retryBlockedReason(operation, currentUserId) === null;
  }

  /** Why this user cannot retry the operation, or null when they can. */
  retryBlockedReason(operation: ProvisioningRecord, currentUserId: string): string | null {
    if (['running', 'retrying', 'cleaning'].includes(operation.status)) {
      return 'This provisioning operation is still running. Wait for it to finish.';
    }
    if (operation.status === 'succeeded') return 'This provisioning operation already succeeded.';
    if (operation.status === 'retried') {
      return 'A newer attempt of this provisioning operation already exists. Retry that one instead.';
    }
    if (!['failed', 'interrupted'].includes(operation.status)) {
      return `A provisioning operation in state '${operation.status}' cannot be retried.`;
    }
    if (operation.requestedById !== currentUserId) {
      return 'Only the person who started this provisioning operation can retry it.';
    }
    if (operation.request == null) {
      return 'This legacy provisioning operation has no retryable request.';
    }
    if (operation.attempt >= MAX_ATTEMPTS) {
      return `This provisioning operation reached the maximum of ${MAX_ATTEMPTS} attempts.`;
    }
    if (!operation.effects.every((effect) => RETRY_SAFE_EFFECTS.has(effect.status))) {
      return 'The failed attempt left changes in the repository or InitPad. Run Clean up first, then retry.';
    }
    return null;
  }

  needsCleanup(operation: Pick<ProvisioningRecord, 'status' | 'effects'>): boolean {
    return (
      ['failed', 'interrupted'].includes(operation.status) &&
      operation.effects.some((effect) => CLEANUP_EFFECTS.has(effect.status))
    );
  }

  /** Read-path reconciliation, rate limited so polling never runs it per request. */
  private async reconcileStaleThrottled(): Promise<void> {
    if (Date.now() - this.lastReconcileAt < RECONCILE_INTERVAL_MS) return;
    this.lastReconcileAt = Date.now();
    await this.reconcileStale().catch((error) => {
      this.logger.warn(`Provisioning reconciliation skipped: ${(error as Error).message}`);
    });
  }

  async reconcileStale(): Promise<number> {
    const now = new Date();
    const legacyCutoff = new Date(now.getTime() - LEASE_MS);
    const ownLive = [...this.localOperations];
    const stale = await this.prisma.provisioningOperation.findMany({
      where: {
        ...(ownLive.length ? { id: { notIn: ownLive } } : {}),
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
      if (this.localOperations.has(operation.id)) continue;
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
          message:
            'The API process stopped before provisioning completed; reconciliation is required',
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
      await this.recordResultSafely(operation.id);
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

  private async recordResultSafely(operationId: string): Promise<void> {
    try {
      await this.auditEvents?.recordOperationResult('provisioning', operationId);
    } catch (error) {
      this.logger.warn(
        `Provisioning audit projection failed for ${operationId}: ${(error as Error).message}`,
      );
    }
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
      dismissedAt: op.dismissedAt ? op.dismissedAt.toISOString() : null,
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
