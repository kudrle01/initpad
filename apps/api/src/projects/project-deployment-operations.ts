import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import {
  activeDeploymentPhasePredecessors,
  ActiveDeploymentPhase,
  DeploymentOperationResult,
  terminalDeploymentPhase,
} from '../domain/deployment-operation-state';
import { EnvName } from '../domain/types';
import {
  AuditEventsService,
  auditOperationAction,
} from '../audit/audit-events.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ExpectedProductionState } from './project-production-approvals';

/**
 * Owns the durable operation lock shared by CI, deployment and environment
 * lifecycle actions. Keeping the lock transitions together prevents two
 * callers from publishing state for the same environment concurrently.
 */
export class ProjectDeploymentOperations {
  private readonly logger = new Logger('ProjectDeploymentOperations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditEvents?: Pick<AuditEventsService, 'record' | 'recordOperationResult'>,
  ) {}

  async recoverInterrupted(): Promise<void> {
    try {
      const interrupted = await this.prisma.deploymentOperation.findMany({
        where: { status: { in: ['running', 'cancelled'] }, finishedAt: null },
        select: { id: true, status: true, agentJobs: { select: { id: true } } },
      });
      for (const operation of interrupted) {
        // Agent jobs are durable across API restarts. Their lease/reclaim and
        // terminal replay own recovery; never turn an offline wait into failure.
        if (operation.agentJobs.length) continue;
        const cancelled = operation.status === 'cancelled';
        await this.prisma.$transaction([
          this.prisma.deploymentOperation.update({
            where: { id: operation.id },
            data: {
              status: cancelled ? 'cancelled' : 'failed',
              phase: cancelled ? 'cancelled' : 'failed',
              message: cancelled
                ? 'Cancellation completed during API restart'
                : 'Interrupted by API restart',
              finishedAt: new Date(),
            },
          }),
          this.prisma.environment.updateMany({
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
          }),
        ]);
        await this.recordResultSafely(operation.id);
      }
    } catch (error) {
      this.logger.warn(`Deployment operation recovery skipped: ${(error as Error).message}`);
    }
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
    if (expectedProductionState && !this.matchesExpectedState(environment, expectedProductionState)) {
      throw new ConflictException(
        'Artifact, target, or production configuration changed. Create a new production request.',
      );
    }
    const operation = await this.prisma.deploymentOperation.create({
      data: {
        environmentId: environment.id,
        kind,
        status: 'running',
        phase: 'queued',
        version,
        buildArtifactId: buildArtifactId ?? null,
        message: kind === 'ci-retry' ? 'Waiting for GitHub Actions build' : 'Preparing deployment',
        targetIdSnapshot: environment.targetId,
        targetName: environment.target?.name ?? environment.provider,
        providerSnapshot: environment.provider,
      },
    });
    const claimed = await this.prisma.environment.updateMany({
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
    if (claimed.count === 1) {
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
    throw new BadRequestException(`Environment '${envName}' already has an active operation`);
  }

  async complete(
    operationId: string,
    status: DeploymentOperationResult,
    message?: string,
  ): Promise<void> {
    const updated = await this.prisma.deploymentOperation
      .update({
        where: { id: operationId },
        data: {
          status,
          phase: terminalDeploymentPhase(status, message),
          message,
          finishedAt: new Date(),
        },
      })
      .then(() => true)
      .catch(() => false);
    await this.prisma.environment.updateMany({
      where: { activeOperationId: operationId },
      data: { activeOperationId: null },
    });
    if (updated) await this.recordResultSafely(operationId);
  }

  async advancePhase(
    operationId: string,
    phase: ActiveDeploymentPhase,
    message?: string,
  ): Promise<void> {
    await this.prisma.deploymentOperation.updateMany({
      where: {
        id: operationId,
        status: 'running',
        finishedAt: null,
        phase: { in: activeDeploymentPhasePredecessors(phase) },
      },
      data: { phase, ...(message ? { message } : {}) },
    });
  }

  async cancelled(operationId: string): Promise<boolean> {
    const operation = await this.prisma.deploymentOperation.findUnique({
      where: { id: operationId },
      select: { status: true },
    });
    return !operation || operation.status === 'cancelled';
  }

  reportProgress(
    operationId: string,
    projectId: string,
    envName: EnvName,
    message: string,
  ): void {
    const phase = /verifying deployment/i.test(message) ? 'verifying' : 'running';
    void Promise.all([
      this.prisma.deploymentOperation.updateMany({
        where: { id: operationId, status: 'running' },
        data: { message },
      }),
      this.advancePhase(operationId, phase),
      this.prisma.environment.updateMany({
        where: { projectId, name: envName, activeOperationId: operationId },
        data: { statusReason: message },
      }),
    ]).catch(() => undefined);
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
    return environment.targetId === expected.targetId
      && environment.allocationId === expected.allocationId
      && environment.configRevision === expected.configRevision
      && (environment.target?.updatedAt.toISOString() ?? null)
        === (expected.targetRevision?.toISOString() ?? null)
      && (environment.allocation?.updatedAt.toISOString() ?? null)
        === (expected.allocationRevision?.toISOString() ?? null);
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
