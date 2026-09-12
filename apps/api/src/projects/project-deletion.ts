import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rmSync } from 'fs';
import { ProviderKind } from '../domain/types';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmActor, repositoryRef } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';
import { deployedImageRef, deploymentSlug, imageRepository } from './project-deployment-identity';
import { ProjectDeploymentOperations } from './project-deployment-operations';
import { ProjectEnvironmentTargets } from './project-environment-targets';

export type ProjectDeletionRow = Prisma.ProjectGetPayload<{
  include: {
    environments: { include: { target: true; allocation: true; buildArtifact: true } };
    owner: true;
  };
}>;

export interface ProjectDeletionOptions {
  repoAction: 'delete' | 'detach' | 'gone';
  confirmCleanupDebt?: boolean;
}

/**
 * Owns destructive project cleanup and its ordering guarantees. A project row
 * survives until runtime, artifact and SCM cleanup have either succeeded or
 * the caller has explicitly accepted a bounded cleanup debt.
 */
export class ProjectDeletion {
  private readonly logger = new Logger('ProjectDeletion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly deployment: DeploymentService,
    private readonly environmentTargets: ProjectEnvironmentTargets,
    private readonly operations: ProjectDeploymentOperations,
    private readonly artifactLifecycle: ProjectArtifactLifecycle,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly actorForRepo: (row: ProjectDeletionRow) => ScmActor,
  ) {}

  async execute(row: ProjectDeletionRow, opts: ProjectDeletionOptions): Promise<void> {
    const remoteAgentDeployments = row.environments.filter(
      (environment) =>
        environment.target?.scope === 'user' &&
        environment.target.kind === 'docker' &&
        (environment.status !== 'empty' ||
          environment.version !== null ||
          environment.activeOperationId !== null),
    );
    if (remoteAgentDeployments.length > 0) {
      throw new BadRequestException(
        `Remove Agent-managed deployments first (${remoteAgentDeployments.map((item) => item.name).join(', ')}). ` +
          'The project can be deleted after their cleanup jobs succeed.',
      );
    }

    const repository = repositoryRef(row);
    await this.cancelUnfinishedOperations(row.id);
    await this.cancelDiagnosticJobs(row.id);

    const slug = deploymentSlug(repository);
    for (const environment of row.environments) {
      const teardownWarning = await this.teardownEnvironment(slug, repository, environment);
      if (!teardownWarning) continue;
      if (!opts.confirmCleanupDebt) {
        throw new BadRequestException(
          `Public ${environment.name} deployment was removed from ${environment.target?.name ?? environment.provider}, but project deletion is waiting for target cleanup: ${teardownWarning}`,
        );
      }
      this.logger.warn(
        `Project ${row.id} deletion explicitly detached pending ${environment.name} cleanup: ${teardownWarning}`,
      );
    }

    // Runtime images and durable artifact objects are removed before touching
    // source control, so a storage outage never destroys the user's source.
    await this.deployment.removeImages(imageRepository(repository));
    const artifactCleanupFailures = await this.artifactLifecycle.purgeProjectObjects(row.id);
    if (artifactCleanupFailures.length && opts.repoAction !== 'gone' && !opts.confirmCleanupDebt) {
      throw new BadRequestException(
        `Project deployments were removed, but deleting stored build artifacts failed: ${artifactCleanupFailures.join('; ')}`,
      );
    }
    if (artifactCleanupFailures.length) {
      this.logger.warn(
        `Project ${row.id}: ${artifactCleanupFailures.length} stored artifact object(s) could not be deleted: ${artifactCleanupFailures.join('; ')}`,
      );
    }

    const scm = this.workspaceScm.provider(repository.provider);
    await scm.deletePackages(repository);
    if (opts.repoAction === 'delete') {
      await scm.deleteRepo(repository, this.actorForRepo(row));
    } else if (opts.repoAction === 'detach') {
      await scm.detachRepo(repository, this.actorForRepo(row));
    }

    rmSync(row.repoPath, { recursive: true, force: true });
    await this.prisma.project.delete({ where: { id: row.id } });
  }

  private async cancelUnfinishedOperations(projectId: string): Promise<void> {
    const unfinishedOperations = await this.prisma.deploymentOperation.findMany({
      where: { environment: { projectId }, finishedAt: null },
      select: { id: true },
    });
    for (const operation of unfinishedOperations) {
      await this.operations.complete(operation.id, 'cancelled', 'Project deletion requested');
    }
  }

  private async teardownEnvironment(
    slug: string,
    repository: ReturnType<typeof repositoryRef>,
    environment: ProjectDeletionRow['environments'][number],
  ): Promise<string | null> {
    try {
      const teardown = await this.deployment.teardown(environment.provider as ProviderKind, {
        projectName: slug,
        env: environment.name,
        imageRef: deployedImageRef(repository, environment),
        connection: this.environmentTargets.connection(environment),
        allocation: this.environmentTargets.allocation(environment),
      });
      const warning = teardown?.warning ?? null;
      // Persist every successful teardown immediately. If a later target
      // fails, the remaining project record is accurate and retryable.
      await this.prisma.environment.update({
        where: { id: environment.id },
        data: {
          status: 'empty',
          version: null,
          buildArtifactId: null,
          url: null,
          statusReason: warning ? `Cleanup pending: ${warning}` : null,
          allocatedPort: null,
          activeOperationId: null,
          deploymentRequired: false,
        },
      });
      return warning;
    } catch (error) {
      const reason = (error as Error).message || 'Unknown teardown error';
      await this.prisma.environment.update({
        where: { id: environment.id },
        data: {
          status: 'failed',
          statusReason: `Cleanup failed: ${reason}`,
          activeOperationId: null,
        },
      });
      throw new BadRequestException(
        `Could not remove ${environment.name} deployment from ${environment.target?.name ?? environment.provider}: ${reason}`,
      );
    }
  }

  /** Fence target-scoped diagnostic leases before deleting project identity. */
  private async cancelDiagnosticJobs(projectId: string): Promise<void> {
    const diagnostics = await this.prisma.workloadDiagnostic.findMany({
      where: { environment: { projectId } },
      select: { currentJobId: true },
    });
    const jobIds = diagnostics.flatMap(({ currentJobId }) => (currentJobId ? [currentJobId] : []));
    if (jobIds.length === 0) return;
    const now = new Date();
    await this.prisma.agentJob.updateMany({
      where: {
        id: { in: jobIds },
        status: { in: ['queued', 'leased'] },
      },
      data: {
        status: 'cancelled',
        progressStage: 'cancelled',
        message: 'Project deletion requested',
        resultCode: 'project_deleted',
        leaseTokenHash: null,
        leaseExpiresAt: null,
        leasedByAgentId: null,
        finishedAt: now,
      },
    });
    await this.prisma.workloadDiagnostic.updateMany({
      where: {
        environment: { projectId },
        status: { in: ['queued', 'running'] },
      },
      data: {
        currentJobId: null,
        status: 'failed',
        message: 'Cancelled because project deletion was requested',
        finishedAt: now,
      },
    });
  }
}
