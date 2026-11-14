import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rmSync } from 'fs';
import { ProviderKind } from '../domain/types';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmActor, repositoryRef } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { isWorkspaceCheckout } from '../generator/generator.service';
import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';
import { deployedImageRef, imageRepository, workloadKey } from './project-deployment-identity';
import { DELETION_LOCK_MS, ProjectDeploymentOperations } from './project-deployment-operations';
import { ProjectEnvironmentTargets } from './project-environment-targets';

export type ProjectDeletionRow = Prisma.ProjectGetPayload<{
  include: {
    environments: { include: { target: true; allocation: true; buildArtifact: true } };
    owner: true;
  };
}>;

/**
 * Stored as Project.repoPath when InitPad keeps no working copy: the SCM
 * provider is the source of truth for every project.
 */
export const NO_LOCAL_CHECKOUT = '';

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
    const lockedAt = await this.acquireLock(row.id);
    try {
      await this.executeLocked(row, opts);
    } catch (error) {
      await this.prisma.project
        .updateMany({
          where: { id: row.id, deletionStartedAt: lockedAt },
          data: { deletionStartedAt: null },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Compare-and-set lock: a second (double-clicked or concurrent webhook)
   * deletion is refused instead of running a second teardown.
   */
  private async acquireLock(projectId: string): Promise<Date> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - DELETION_LOCK_MS);
    const locked = await this.prisma.project.updateMany({
      where: {
        id: projectId,
        OR: [{ deletionStartedAt: null }, { deletionStartedAt: { lt: staleBefore } }],
      },
      data: { deletionStartedAt: now },
    });
    if (locked.count === 1) return now;
    const exists = await this.prisma.project.count({ where: { id: projectId } });
    if (!exists) throw new NotFoundException(`Project '${projectId}' not found`);
    throw new ConflictException(
      'This project is already being deleted. Wait for that deletion to finish.',
    );
  }

  /**
   * A deployment executed by an API process holds a live execution lease. Its
   * provider call cannot be interrupted safely, so deletion marks it cancelled
   * (the executor tears the new workload down when it observes that) and is
   * refused until the executor has finished. Deleting underneath it would
   * leave the freshly deployed workload orphaned on the target.
   */
  private async refuseWhileExecuting(projectId: string): Promise<void> {
    const executing = await this.prisma.deploymentOperation.findMany({
      where: {
        environment: { projectId },
        finishedAt: null,
        executionOwner: { not: null },
        executionLeaseExpiresAt: { gt: new Date() },
      },
      select: { id: true, environment: { select: { name: true } } },
    });
    if (executing.length === 0) return;
    await this.prisma.deploymentOperation.updateMany({
      where: { id: { in: executing.map(({ id }) => id) }, finishedAt: null },
      data: { status: 'cancelled', message: 'Cancelled because project deletion was requested' },
    });
    const names = [...new Set(executing.map(({ environment }) => environment.name))].join(', ');
    throw new ConflictException(
      `A deployment is still running in ${names}. It has been cancelled; delete the project again once it has stopped.`,
    );
  }

  private async executeLocked(
    row: ProjectDeletionRow,
    opts: ProjectDeletionOptions,
  ): Promise<void> {
    await this.refuseWhileExecuting(row.id);
    // A disconnected or retired target can no longer receive management
    // commands (its credentials are revoked), so its deployments can only be
    // abandoned: the record is released while the workload may survive on that
    // server. This is cleanup debt and requires the explicit acknowledgement.
    const abandoned = row.environments.filter(
      (environment) => unmanagedTarget(environment) && hasDeploymentState(environment),
    );
    if (abandoned.length > 0 && !opts.confirmCleanupDebt && opts.repoAction !== 'gone') {
      throw new BadRequestException(
        `${abandoned
          .map((environment) => `${environment.name} (${environment.target!.name})`)
          .join(', ')} cannot be cleaned up because the target is no longer connected. ` +
          'Reconnect the target, or confirm that the deployment may remain on that server.',
      );
    }

    // Only an environment that may actually hold a workload on the server needs
    // an Agent cleanup first. A build or publish that failed before anything was
    // deployed leaves status "failed" but nothing to remove, and the user could
    // otherwise neither remove it from the target nor delete the project.
    const remoteAgentDeployments: typeof row.environments = [];
    for (const environment of row.environments) {
      if (
        !unmanagedTarget(environment) &&
        environment.target?.scope === 'user' &&
        environment.target.kind === 'docker' &&
        (await this.mayHoldRemoteWorkload(environment))
      ) {
        remoteAgentDeployments.push(environment);
      }
    }
    if (remoteAgentDeployments.length > 0) {
      throw new BadRequestException(
        `Remove Agent-managed deployments first (${remoteAgentDeployments.map((item) => item.name).join(', ')}). ` +
          'The project can be deleted after their cleanup jobs succeed.',
      );
    }

    const repository = repositoryRef(row);
    await this.cancelUnfinishedOperations(row.id);
    await this.cancelDiagnosticJobs(row.id);
    await this.cancelLifecycleJobs(row.id);

    const slug = workloadKey(row);
    for (const environment of row.environments) {
      if (unmanagedTarget(environment)) {
        if (hasDeploymentState(environment)) {
          this.logger.warn(
            `Project ${row.id} deletion abandoned ${environment.name} on ${environment.target!.managementState} target ${environment.target!.id}; its workload was not removed`,
          );
        }
        continue;
      }
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

    // Older releases stored a relative `owner/name` for imports. Only a path
    // inside the workspace directory is ever removed; anything else is left
    // alone instead of resolving against the API's working directory.
    if (isWorkspaceCheckout(row.repoPath)) {
      rmSync(row.repoPath, { recursive: true, force: true });
    }
    await this.prisma.project.delete({ where: { id: row.id } });
  }

  /**
   * True when a workload may exist on the Agent's server: InitPad recorded a
   * version or address, the workload is running or stopped, or a deploy/start
   * job succeeded or is in flight (cancelling it cannot undo a started
   * container). A failed job rolls its candidate back, so it does not count.
   */
  private async mayHoldRemoteWorkload(environment: DeletionEnvironment): Promise<boolean> {
    if (
      environment.version !== null ||
      environment.url !== null ||
      environment.status === 'running' ||
      environment.status === 'stopped'
    ) {
      return true;
    }
    const jobs = await this.prisma.agentJob.count({
      where: {
        deploymentOperation: { environmentId: environment.id },
        kind: { in: ['deploy', 'start'] },
        status: { in: ['leased', 'succeeded'] },
      },
    });
    return jobs > 0;
  }

  private async cancelUnfinishedOperations(projectId: string): Promise<void> {
    // An expired execution lease belongs to a process that died; release it
    // so the operation can be completed here rather than left unfinished.
    await this.prisma.deploymentOperation.updateMany({
      where: {
        environment: { projectId },
        finishedAt: null,
        executionOwner: { not: null },
        executionLeaseExpiresAt: { lte: new Date() },
      },
      data: { executionOwner: null, executionLeaseExpiresAt: null },
    });
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

  /**
   * Fence queued Agent lifecycle jobs. A disabled Agent never leases them, and
   * they must not stay queued for a target that may later be reconnected.
   */
  private async cancelLifecycleJobs(projectId: string): Promise<void> {
    await this.prisma.agentJob.updateMany({
      where: {
        deploymentOperation: { environment: { projectId } },
        status: { in: ['blocked', 'queued', 'leased'] },
      },
      data: {
        status: 'cancelled',
        message: 'Project deletion requested',
        resultCode: 'project_deleted',
        leaseTokenHash: null,
        leaseExpiresAt: null,
        leasedByAgentId: null,
        finishedAt: new Date(),
      },
    });
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

type DeletionEnvironment = ProjectDeletionRow['environments'][number];

/** A user target that was disconnected or retired and accepts no commands. */
export function unmanagedTarget(environment: {
  target?: { scope: string; managementState?: string | null } | null;
}): boolean {
  return (
    environment.target?.scope === 'user' &&
    (environment.target.managementState ?? 'active') !== 'active'
  );
}

function hasDeploymentState(environment: DeletionEnvironment): boolean {
  return (
    environment.status !== 'empty' ||
    environment.version !== null ||
    environment.activeOperationId !== null ||
    environment.statusReason?.startsWith('Cleanup pending:') === true
  );
}
