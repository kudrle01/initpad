import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  activeDeploymentPhasePredecessors,
  ActiveDeploymentPhase,
  DeploymentOperationResult,
  terminalDeploymentPhase,
} from '../domain/deployment-operation-state';
import { EnvName } from '../domain/types';
import { AuditEventsService, auditOperationAction } from '../audit/audit-events.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ExpectedProductionState } from './project-production-approvals';
import { newCorrelationId } from '../common/request-context';
import {
  serializableCapacityTransaction,
  WorkspaceCapacityService,
} from '../workspaces/workspace-capacity.service';

const EXECUTION_LEASE_MS = 90_000;
const EXECUTION_RENEW_MS = 30_000;
const LEGACY_EXECUTION_GRACE_MS = EXECUTION_LEASE_MS;

type ExecutionContext = {
  operationId: string;
  generation: number;
  lost: Error | null;
  completed: boolean;
};

type ExecutionClaim = { generation: number };

/**
 * Owns the durable operation lock shared by CI, deployment and environment
 * lifecycle actions. Keeping the lock transitions together prevents two
 * callers from publishing state for the same environment concurrently.
 */
export class ProjectDeploymentOperations {
  private readonly logger = new Logger('ProjectDeploymentOperations');
  private readonly capacity: WorkspaceCapacityService;
  private readonly instanceId = randomUUID();
  private readonly execution = new AsyncLocalStorage<ExecutionContext>();
  private readonly localExecutions = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditEvents?: Pick<AuditEventsService, 'record' | 'recordOperationResult'>,
  ) {
    this.capacity = new WorkspaceCapacityService(prisma);
  }

  async recoverInterrupted(): Promise<void> {
    try {
      const now = new Date();
      const legacyCutoff = new Date(now.getTime() - LEGACY_EXECUTION_GRACE_MS);
      const interrupted = await this.prisma.deploymentOperation.findMany({
        where: {
          status: { in: ['running', 'cancelled'] },
          finishedAt: null,
          OR: [
            { executionLeaseExpiresAt: { lte: now } },
            {
              executionOwner: null,
              executionLeaseExpiresAt: null,
              kind: { not: 'ci-retry' },
              createdAt: { lte: legacyCutoff },
            },
          ],
        },
        select: {
          id: true,
          status: true,
          kind: true,
          createdAt: true,
          executionOwner: true,
          executionGeneration: true,
          executionLeaseExpiresAt: true,
          agentJobs: { select: { id: true } },
        },
      });
      for (const operation of interrupted) {
        // Agent jobs are durable across API restarts. Their lease/reclaim and
        // terminal replay own recovery; never turn an offline wait into failure.
        if (operation.agentJobs.length) continue;
        const cancelled = operation.status === 'cancelled';
        const claimed = await this.prisma.deploymentOperation.updateMany({
          where: {
            id: operation.id,
            status: operation.status,
            finishedAt: null,
            executionOwner: operation.executionOwner,
            executionGeneration: operation.executionGeneration,
            OR: [
              { executionLeaseExpiresAt: { lte: now } },
              {
                executionOwner: null,
                executionLeaseExpiresAt: null,
                kind: { not: 'ci-retry' },
                createdAt: { lte: legacyCutoff },
              },
            ],
          },
          data: {
            status: cancelled ? 'cancelled' : 'failed',
            phase: cancelled ? 'cancelled' : 'failed',
            message: cancelled
              ? 'Cancellation completed during API restart'
              : 'Interrupted by API restart',
            finishedAt: new Date(),
            executionOwner: null,
            executionLeaseExpiresAt: null,
          },
        });
        if (claimed.count !== 1) continue;
        await this.prisma.environment.updateMany({
          where: { activeOperationId: operation.id },
          data: {
            activeOperationId: null,
            status: cancelled ? 'empty' : 'failed',
            statusReason: cancelled
              ? null
              : 'Deployment was interrupted by an API restart. Deploy to retry.',
            ...(cancelled
              ? {
                  version: null,
                  buildArtifactId: null,
                  url: null,
                  allocatedPort: null,
                  deploymentRequired: false,
                }
              : {}),
          },
        });
        await this.recordResultSafely(operation.id);
      }
    } catch (error) {
      this.logger.warn(`Deployment operation recovery skipped: ${(error as Error).message}`);
    }
  }

  /**
   * Runs process-bound work under a renewable, generation-fenced database
   * lease. Nested calls for the same operation reuse the current context.
   */
  async runWithExecutionLease<T>(operationId: string, task: () => Promise<T>): Promise<T> {
    const parent = this.execution.getStore();
    if (parent?.operationId === operationId) {
      await this.assertExecution(operationId);
      return task();
    }
    if (this.localExecutions.has(operationId)) {
      throw new ConflictException('Deployment operation is already executing in this API process');
    }

    const claim = await this.claimExecution(operationId);
    if (!claim) throw new ConflictException('Deployment operation is owned by another API process');

    const context: ExecutionContext = {
      operationId,
      generation: claim.generation,
      lost: null,
      completed: false,
    };
    this.localExecutions.add(operationId);
    const timer = setInterval(() => {
      void this.renewExecution(context).catch((error) => {
        context.lost =
          error instanceof Error ? error : new ConflictException('Deployment execution lease lost');
      });
    }, EXECUTION_RENEW_MS);
    timer.unref();

    try {
      return await this.execution.run(context, async () => {
        const result = await task();
        if (context.lost) throw context.lost;
        return result;
      });
    } finally {
      clearInterval(timer);
      this.localExecutions.delete(operationId);
      if (!context.completed) {
        // Close the local renewal loop before releasing a durable Agent
        // handoff. An already queued timer must not race the owner clear and
        // misreport an intentional release as a lost lease.
        context.completed = true;
        await this.releaseExecution(context).catch(() => undefined);
      }
    }
  }

  async assertExecution(operationId: string): Promise<void> {
    const context = this.execution.getStore();
    if (!context || context.operationId !== operationId) {
      throw new ConflictException('Deployment execution lease is not held by this task');
    }
    if (context.lost) throw context.lost;
    await this.renewExecution(context);
    const lost = context.lost as Error | null;
    if (lost) throw lost;
  }

  async begin(
    projectId: string,
    envName: EnvName,
    kind: string,
    version: string | null,
    buildArtifactId?: string | null,
    actorUserId?: string,
    expectedProductionState?: ExpectedProductionState,
  ): Promise<string> {
    const environment = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
      include: {
        target: { select: { name: true, updatedAt: true } },
        allocation: { select: { updatedAt: true } },
        project: { select: { id: true, name: true, workspaceId: true } },
      },
    });
    if (!environment) throw new NotFoundException(`Environment '${envName}' not found`);
    if (
      expectedProductionState &&
      !this.matchesExpectedState(environment, expectedProductionState)
    ) {
      throw new ConflictException(
        'Artifact, target, or production configuration changed. Create a new production request.',
      );
    }
    const { operation, claimed } = await serializableCapacityTransaction(
      this.prisma,
      async (tx) => {
        await this.capacity.assertAvailable(
          environment.project.workspaceId,
          'concurrentOperations',
          1,
          tx,
        );
        const operation = await tx.deploymentOperation.create({
          data: {
            correlationId: newCorrelationId(),
            environmentId: environment.id,
            kind,
            status: 'running',
            phase: 'queued',
            version,
            buildArtifactId: buildArtifactId ?? null,
            message:
              kind === 'ci-retry' ? 'Waiting for GitHub Actions build' : 'Preparing deployment',
            targetIdSnapshot: environment.targetId,
            targetName: environment.target?.name ?? environment.provider,
            providerSnapshot: environment.provider,
          },
        });
        const claimed = await tx.environment.updateMany({
          where: {
            id: environment.id,
            activeOperationId: null,
            ...(expectedProductionState
              ? {
                  targetId: expectedProductionState.targetId,
                  allocationId: expectedProductionState.allocationId,
                  configRevision: expectedProductionState.configRevision,
                }
              : {}),
          },
          data: {
            activeOperationId: operation.id,
            status: 'deploying',
            statusReason:
              kind === 'start'
                ? 'Starting environment'
                : kind === 'stop'
                  ? 'Stopping environment'
                  : kind === 'remove'
                    ? 'Removing deployment'
                    : 'Preparing deployment',
            ...(!['start', 'stop', 'remove'].includes(kind) ? { deploymentRequired: true } : {}),
          },
        });
        return { operation, claimed };
      },
    );
    if (claimed.count === 1) {
      this.logger.log({
        event: 'deployment.operation.started',
        correlationId: operation.correlationId,
        operationId: operation.id,
        projectId,
        environment: envName,
        kind,
      });
      if (expectedProductionState) {
        const claimedState = await this.prisma.environment.findUnique({
          where: { id: environment.id },
          include: {
            target: { select: { updatedAt: true } },
            allocation: { select: { updatedAt: true } },
          },
        });
        if (!claimedState || !this.matchesExpectedState(claimedState, expectedProductionState)) {
          await this.cancelUnstarted(operation.id, environment);
          throw new ConflictException(
            'Production target changed while approval was being applied. Create a new request.',
          );
        }
      }
      try {
        await this.auditEvents?.record({
          workspaceId: environment.project.workspaceId,
          actorUserId,
          action: auditOperationAction.deployment(kind, 'requested'),
          outcome: 'accepted',
          resourceType: 'project',
          resourceId: environment.project.id,
          resourceName: environment.project.name,
          operation: { type: 'deployment', id: operation.id },
          details: { environment: envName, kind },
        });
      } catch (error) {
        await this.prisma.$transaction([
          this.prisma.deploymentOperation.update({
            where: { id: operation.id },
            data: {
              status: 'cancelled',
              phase: 'cancelled',
              message: 'Deployment could not be recorded in the audit log',
              finishedAt: new Date(),
            },
          }),
          this.prisma.environment.updateMany({
            where: { id: environment.id, activeOperationId: operation.id },
            data: {
              activeOperationId: null,
              status: environment.status,
              statusReason: environment.statusReason,
              deploymentRequired: environment.deploymentRequired,
            },
          }),
        ]);
        throw error;
      }
      return operation.id;
    }
    await this.prisma.deploymentOperation.update({
      where: { id: operation.id },
      data: {
        status: 'cancelled',
        phase: 'cancelled',
        message: 'Another operation is already active',
        finishedAt: new Date(),
      },
    });
    this.logger.warn({
      event: 'deployment.operation.rejected',
      correlationId: operation.correlationId,
      operationId: operation.id,
      projectId,
      environment: envName,
      reason: 'active-operation-conflict',
    });
    throw new BadRequestException(`Environment '${envName}' already has an active operation`);
  }

  async complete(
    operationId: string,
    status: DeploymentOperationResult,
    message?: string,
  ): Promise<void> {
    const context = this.execution.getStore();
    if (context?.operationId === operationId) {
      await this.completeOwned(context, status, message);
      return;
    }
    const changed = await this.prisma.deploymentOperation
      .updateMany({
        where: { id: operationId, executionOwner: null, finishedAt: null },
        data: {
          status,
          phase: terminalDeploymentPhase(status, message),
          message,
          finishedAt: new Date(),
        },
      })
      .then((result) => result.count)
      .catch(() => null);
    if (changed === 0) {
      const existing = await this.prisma.deploymentOperation
        .findUnique({
          where: { id: operationId },
          select: {
            correlationId: true,
            status: true,
            finishedAt: true,
            executionOwner: true,
          },
        })
        .catch(() => null);
      if (
        !existing ||
        existing.executionOwner !== null ||
        existing.status !== status ||
        existing.finishedAt === null
      ) {
        return;
      }
    }
    await this.prisma.environment.updateMany({
      where: { activeOperationId: operationId },
      data: { activeOperationId: null },
    });
    if (changed !== null) {
      const updated = await this.prisma.deploymentOperation
        .findUnique({ where: { id: operationId }, select: { correlationId: true } })
        .catch(() => null);
      this.logger[status === 'failed' ? 'warn' : 'log']({
        event: 'deployment.operation.completed',
        correlationId: updated?.correlationId,
        operationId,
        status,
        ...(message ? { message } : {}),
      });
      await this.recordResultSafely(operationId);
    }
  }

  async advancePhase(
    operationId: string,
    phase: ActiveDeploymentPhase,
    message?: string,
  ): Promise<void> {
    const context = this.execution.getStore();
    if (context?.operationId === operationId) await this.assertExecution(operationId);
    await this.prisma.deploymentOperation.updateMany({
      where: {
        id: operationId,
        status: 'running',
        finishedAt: null,
        phase: { in: activeDeploymentPhasePredecessors(phase) },
        ...(context?.operationId === operationId
          ? {
              executionOwner: this.instanceId,
              executionGeneration: context.generation,
            }
          : { executionOwner: null }),
      },
      data: { phase, ...(message ? { message } : {}) },
    });
  }

  async cancelled(operationId: string): Promise<boolean> {
    const context = this.execution.getStore();
    if (context?.operationId === operationId) await this.assertExecution(operationId);
    const operation = await this.prisma.deploymentOperation.findUnique({
      where: { id: operationId },
      select: { status: true },
    });
    return !operation || operation.status === 'cancelled';
  }

  reportProgress(operationId: string, projectId: string, envName: EnvName, message: string): void {
    const context = this.execution.getStore();
    if (!context || context.operationId !== operationId) return;
    const phase = /verifying deployment/i.test(message) ? 'verifying' : 'running';
    void this.assertExecution(operationId)
      .then(() =>
        Promise.all([
          this.prisma.deploymentOperation.updateMany({
            where: {
              id: operationId,
              status: 'running',
              executionOwner: this.instanceId,
              executionGeneration: context.generation,
            },
            data: { message },
          }),
          this.advancePhase(operationId, phase),
          this.prisma.environment.updateMany({
            where: { projectId, name: envName, activeOperationId: operationId },
            data: { statusReason: message },
          }),
        ]),
      )
      .catch(() => undefined);
  }

  private async claimExecution(operationId: string): Promise<ExecutionClaim | null> {
    const rows = await this.prisma.$queryRaw<ExecutionClaim[]>(Prisma.sql`
      UPDATE "DeploymentOperation"
      SET
        "executionOwner" = ${this.instanceId},
        "executionGeneration" = CASE
          WHEN "executionOwner" = ${this.instanceId} THEN "executionGeneration"
          ELSE "executionGeneration" + 1
        END,
        "executionLeaseExpiresAt" = CURRENT_TIMESTAMP
          + (${EXECUTION_LEASE_MS} * INTERVAL '1 millisecond')
      WHERE "id" = ${operationId}
        AND "status" IN ('running', 'cancelled')
        AND "finishedAt" IS NULL
        AND (
          "executionOwner" IS NULL
          OR "executionOwner" = ${this.instanceId}
          OR "executionLeaseExpiresAt" <= CURRENT_TIMESTAMP
        )
      RETURNING "executionGeneration" AS "generation"
    `);
    return rows[0] ?? null;
  }

  private async renewExecution(context: ExecutionContext): Promise<void> {
    if (context.completed || context.lost) {
      if (context.lost) throw context.lost;
      return;
    }
    const rows = await this.prisma.$queryRaw<ExecutionClaim[]>(Prisma.sql`
      UPDATE "DeploymentOperation"
      SET
        "executionLeaseExpiresAt" = CURRENT_TIMESTAMP
          + (${EXECUTION_LEASE_MS} * INTERVAL '1 millisecond')
      WHERE "id" = ${context.operationId}
        AND "executionOwner" = ${this.instanceId}
        AND "executionGeneration" = ${context.generation}
        AND "status" IN ('running', 'cancelled')
        AND "finishedAt" IS NULL
        AND "executionLeaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "executionGeneration" AS "generation"
    `);
    if (rows.length !== 1) {
      context.lost = new ConflictException('Deployment execution lease was lost');
      throw context.lost;
    }
  }

  private async releaseExecution(context: ExecutionContext): Promise<void> {
    await this.prisma.deploymentOperation.updateMany({
      where: {
        id: context.operationId,
        executionOwner: this.instanceId,
        executionGeneration: context.generation,
      },
      data: { executionOwner: null, executionLeaseExpiresAt: null },
    });
  }

  private async completeOwned(
    context: ExecutionContext,
    status: DeploymentOperationResult,
    message?: string,
  ): Promise<void> {
    await this.assertExecution(context.operationId);
    // Stop periodic renewal before the terminal compare-and-set. Otherwise a
    // timer already in flight can observe the intentional owner clear as a
    // lease loss after the operation has committed successfully.
    context.completed = true;
    let changed: { count: number };
    try {
      changed = await this.prisma.deploymentOperation.updateMany({
        where: {
          id: context.operationId,
          status: { in: ['running', 'cancelled'] },
          finishedAt: null,
          executionOwner: this.instanceId,
          executionGeneration: context.generation,
        },
        data: {
          status,
          phase: terminalDeploymentPhase(status, message),
          message,
          finishedAt: new Date(),
          executionOwner: null,
          executionLeaseExpiresAt: null,
        },
      });
    } catch (error) {
      context.completed = false;
      throw error;
    }
    if (changed.count !== 1) {
      context.completed = false;
      context.lost = new ConflictException('Deployment completion lost its execution fence');
      throw context.lost;
    }
    await this.prisma.environment.updateMany({
      where: { activeOperationId: context.operationId },
      data: { activeOperationId: null },
    });
    const updated = await this.prisma.deploymentOperation.findUnique({
      where: { id: context.operationId },
      select: { correlationId: true },
    });
    this.logger[status === 'failed' ? 'warn' : 'log']({
      event: 'deployment.operation.completed',
      correlationId: updated?.correlationId,
      operationId: context.operationId,
      status,
      ...(message ? { message } : {}),
    });
    await this.recordResultSafely(context.operationId);
  }

  private async recordResultSafely(operationId: string): Promise<void> {
    try {
      await this.auditEvents?.recordOperationResult('deployment', operationId);
    } catch (error) {
      this.logger.warn(
        `Deployment audit projection failed for ${operationId}: ${(error as Error).message}`,
      );
    }
  }

  private matchesExpectedState(
    environment: {
      targetId: string | null;
      allocationId: string | null;
      configRevision: number;
      target: { updatedAt: Date } | null;
      allocation: { updatedAt: Date } | null;
    },
    expected: ExpectedProductionState,
  ): boolean {
    return (
      environment.targetId === expected.targetId &&
      environment.allocationId === expected.allocationId &&
      environment.configRevision === expected.configRevision &&
      (environment.target?.updatedAt.toISOString() ?? null) ===
        (expected.targetRevision?.toISOString() ?? null) &&
      (environment.allocation?.updatedAt.toISOString() ?? null) ===
        (expected.allocationRevision?.toISOString() ?? null)
    );
  }

  private async cancelUnstarted(
    operationId: string,
    environment: {
      id: string;
      status: string;
      statusReason: string | null;
      deploymentRequired: boolean;
    },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.deploymentOperation.update({
        where: { id: operationId },
        data: {
          status: 'cancelled',
          phase: 'cancelled',
          message: 'Approved production state changed before deployment started',
          finishedAt: new Date(),
        },
      }),
      this.prisma.environment.updateMany({
        where: { id: environment.id, activeOperationId: operationId },
        data: {
          activeOperationId: null,
          status: environment.status,
          statusReason: environment.statusReason,
          deploymentRequired: environment.deploymentRequired,
        },
      }),
    ]);
  }
}
