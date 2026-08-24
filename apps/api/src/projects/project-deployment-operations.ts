import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { EnvName } from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';

export type DeploymentOperationResult = 'succeeded' | 'failed' | 'cancelled';

/**
 * Owns the durable operation lock shared by CI, deployment and environment
 * lifecycle actions. Keeping the lock transitions together prevents two
 * callers from publishing state for the same environment concurrently.
 */
export class ProjectDeploymentOperations {
  private readonly logger = new Logger('ProjectDeploymentOperations');

  constructor(private readonly prisma: PrismaService) {}

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
  ): Promise<string> {
    const environment = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
      include: { target: { select: { name: true } } },
    });
    if (!environment) throw new NotFoundException(`Environment '${envName}' not found`);
    const operation = await this.prisma.deploymentOperation.create({
      data: {
        environmentId: environment.id,
        kind,
        status: 'running',
        version,
        buildArtifactId: buildArtifactId ?? null,
        message: kind === 'ci-retry' ? 'Waiting for GitHub Actions build' : 'Preparing deployment',
        targetIdSnapshot: environment.targetId,
        targetName: environment.target?.name ?? environment.provider,
        providerSnapshot: environment.provider,
      },
    });
    const claimed = await this.prisma.environment.updateMany({
      where: { id: environment.id, activeOperationId: null },
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
    if (claimed.count === 1) return operation.id;
    await this.prisma.deploymentOperation.update({
      where: { id: operation.id },
      data: {
        status: 'cancelled',
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
    await this.prisma.deploymentOperation
      .update({
        where: { id: operationId },
        data: { status, message, finishedAt: new Date() },
      })
      .catch(() => undefined);
    await this.prisma.environment.updateMany({
      where: { activeOperationId: operationId },
      data: { activeOperationId: null },
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
    void Promise.all([
      this.prisma.deploymentOperation.updateMany({
        where: { id: operationId, status: 'running' },
        data: { message },
      }),
      this.prisma.environment.updateMany({
        where: { projectId, name: envName, activeOperationId: operationId },
        data: { statusReason: message },
      }),
    ]).catch(() => undefined);
  }
}
