import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { tokenMatches } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { repositoryRef, ScmActor, ScmBuildArtifact, ScmRepositoryRef } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { CI_RUNNING_REASON } from './ci-state';
import { ProjectArtifactIngestion } from './project-artifact-ingestion';
import {
  ActiveOperationConflict,
  ProjectDeploymentOperations,
} from './project-deployment-operations';

export interface CiArtifactInput {
  ciStatus?: string;
  artifactId?: string;
  artifactDigest?: string;
}

type DeployInBackground = (
  projectId: string,
  version: string,
  operationId: string,
) => Promise<void>;

type ScheduleDeployment = (projectId: string, version: string, kind: string) => Promise<void>;
type VerifyRegistryArtifact = (
  project: { id: string; workspaceId: string },
  repository: ScmRepositoryRef,
  version: string,
) => Promise<void>;

type CiProject = NonNullable<Awaited<ReturnType<PrismaService['project']['findUnique']>>>;

const PENDING_DRAIN_BATCH = 25;

type FindRenamedProject = (
  repo: string,
  token: string,
) => Promise<Awaited<ReturnType<PrismaService['project']['findFirst']>>>;

/**
 * Repository-authenticated CI callback state machine. It validates the source
 * event, handles retry-tag ownership and decides whether an immutable artifact
 * is ingested or an existing registry image can deploy directly.
 */
export class ProjectCiOrchestrator {
  private readonly logger = new Logger('ProjectCiOrchestrator');
  private draining?: Promise<void>;
  private drainAgain = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly operations: ProjectDeploymentOperations,
    private readonly ingestion: ProjectArtifactIngestion,
    private readonly resolveActor: (projectId: string) => Promise<ScmActor>,
    private readonly deployInBackground: DeployInBackground,
    private readonly scheduleDeployment: ScheduleDeployment,
    private readonly verifyRegistryArtifact: VerifyRegistryArtifact,
    private readonly findRenamedProject: FindRenamedProject = () => Promise.resolve(null),
  ) {}

  // The callback names its repository and proves itself with the project's
  // token. A name no project carries may be a rename: the token then finds
  // the project and the provider has to confirm the new name (ADR-155).
  private async callbackProject(repo: string, token: string) {
    const candidates = await this.prisma.project.findMany({
      where: { scmFullName: repo },
    });
    const project = candidates.find((candidate) =>
      tokenMatches(token, candidate.ciDeployTokenHash),
    );
    if (project) return { project, known: true };
    if (candidates.length > 0) return { project: null, known: true };
    return { project: await this.findRenamedProject(repo, token), known: false };
  }

  async started(repo: string, sha: string, ref: string, token: string): Promise<void> {
    this.assertRepositoryCoordinates(repo);
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new BadRequestException('CI start requires a full 40-character commit SHA');
    }

    const { project, known } = await this.callbackProject(repo, token);
    if (!project) {
      if (known) {
        throw new UnauthorizedException('Invalid CI token for this repository');
      }
      throw new NotFoundException('CI project is not ready yet');
    }

    const branch = project.scmDefaultBranch || 'main';
    if (ref && ref !== branch && ref !== `refs/heads/${branch}`) return;
    await this.prisma.environment.updateMany({
      where: {
        projectId: project.id,
        name: 'dev',
        status: 'deploying',
        version: null,
        activeOperationId: null,
      },
      data: { statusReason: CI_RUNNING_REASON },
    });
  }

  async deployFromCi(
    repo: string,
    sha: string,
    ref: string,
    token: string,
    artifactInput: CiArtifactInput = {},
  ): Promise<void> {
    this.assertRepositoryCoordinates(repo);
    const retryTag = ref.replace(/^refs\/tags\//, '');
    const isRetry = /^initpad-retry-[a-z0-9-]+$/.test(retryTag);
    const { project, known } = await this.callbackProject(repo, token);
    if (!project) {
      if (known) {
        throw new UnauthorizedException('Invalid CI token for this repository');
      }
      this.logger.warn(`CI deploy: project '${repo}' not found`);
      return;
    }

    const repository = repositoryRef(project);
    const scm = this.workspaceScm.provider(repository.provider);
    const branch = repository.defaultBranch;
    if (ref && ref !== branch && ref !== `refs/heads/${branch}` && !isRetry) return;
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new BadRequestException('CI deploy requires a full 40-character commit SHA');
    }

    const dev = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: project.id, name: 'dev' } },
    });
    const ciStatus = (artifactInput.ciStatus || 'success').trim().toLowerCase();
    if (!['success', 'failure', 'cancelled', 'skipped'].includes(ciStatus)) {
      throw new BadRequestException(`Unsupported CI result '${ciStatus}'`);
    }
    if (ciStatus !== 'success') {
      await this.publishCiFailure(project, dev, repository, retryTag, isRetry, sha, ciStatus);
      return;
    }

    const buildArtifact = await this.resolveArtifact(project.id, repository, sha, artifactInput);
    if (buildArtifact === 'duplicate') return;

    if (!dev) {
      if (isRetry) {
        this.logger.log(`Ignoring CI retry for pipeline without dev: ${repo} (${retryTag})`);
        return;
      }
      await this.prisma.project.update({
        where: { id: project.id },
        data: { lastCommit: `ci: verifying ${sha.slice(0, 7)}` },
      });
      if (buildArtifact) {
        await this.ingestion.queueVerification(project.id, repository, buildArtifact);
      } else {
        void this.verifyRegistryArtifact(project, repository, sha)
          .then(() =>
            this.prisma.project.update({
              where: { id: project.id },
              data: { lastCommit: `ci: verified ${sha.slice(0, 7)}` },
            }),
          )
          .catch((error) => {
            this.logger.error(
              `Registry artifact verification failed for ${repository.fullName}: ${(error as Error).message}`,
            );
            return this.prisma.project
              .update({
                where: { id: project.id },
                data: { lastCommit: `ci: artifact failed ${sha.slice(0, 7)}` },
              })
              .catch(() => undefined);
          });
      }
      this.logger.log(`CI artifact verification: ${repo} (${sha})`);
      return;
    }

    if (isRetry) {
      const actor = await this.resolveActor(project.id);
      try {
        const operation = dev.activeOperationId
          ? await this.prisma.deploymentOperation.findUnique({
              where: { id: dev.activeOperationId },
            })
          : null;
        if (
          !operation ||
          operation.kind !== 'ci-retry' ||
          operation.status !== 'running' ||
          operation.version !== sha
        ) {
          this.logger.log(`Ignoring stale CI retry for ${repo} (${retryTag})`);
          return;
        }
        await this.prisma.project.update({
          where: { id: project.id },
          data: { lastCommit: `ci: retry ${sha.slice(0, 7)}` },
        });
        if (buildArtifact) {
          await this.ingestion.queue(project.id, repository, buildArtifact, operation.id);
        } else {
          void this.deployInBackground(project.id, sha, operation.id);
        }
        this.logger.log(`CI retry deploy: ${repo} → dev (${sha})`);
        return;
      } finally {
        await scm.deleteTag(repository, retryTag, actor);
      }
    }

    if (dev.status === 'empty' && project.lastCommit !== 'import: existing repository') {
      this.logger.log(`Ignoring CI deploy for disabled dev environment: ${repo}`);
      return;
    }

    if (dev.activeOperationId) {
      await this.queuePending(project.id, dev.id, sha, artifactInput);
      return;
    }
    try {
      await this.startDeploy(project, repository, sha, buildArtifact);
    } catch (error) {
      // Another request claimed dev between the read above and begin().
      if (!(error instanceof ActiveOperationConflict)) throw error;
      await this.queuePending(project.id, dev.id, sha, artifactInput);
    }
  }

  private async startDeploy(
    project: CiProject,
    repository: ScmRepositoryRef,
    sha: string,
    buildArtifact: ScmBuildArtifact | null,
  ): Promise<void> {
    const version = sha || '0.1.0';
    if (buildArtifact) {
      const operationId = await this.operations.begin(project.id, 'dev', 'ci-deploy', version);
      await this.setLastCommit(project.id, `ci: deploy ${version.slice(0, 7)}`);
      await this.ingestion.queue(project.id, repository, buildArtifact, operationId);
    } else {
      await this.scheduleDeployment(project.id, version, 'ci-deploy');
      await this.setLastCommit(project.id, `ci: deploy ${version.slice(0, 7)}`);
    }
    this.logger.log(`CI deploy: ${repository.fullName} → dev (${version})`);
  }

  /**
   * Latest wins (ADR-178): a successful build that arrives while dev is busy
   * replaces any older queued build and deploys once dev is free. Nothing is
   * written to the operation history until it actually starts.
   */
  private async queuePending(
    projectId: string,
    environmentId: string,
    sha: string,
    input: CiArtifactInput,
  ): Promise<void> {
    await this.prisma.environment.update({
      where: { id: environmentId },
      data: {
        pendingCiVersion: sha.toLowerCase(),
        pendingCiArtifactId: input.artifactId ?? null,
        pendingCiArtifactDigest: input.artifactDigest ?? null,
        pendingCiQueuedAt: new Date(),
      },
    });
    await this.setLastCommit(projectId, `ci: queued ${sha.slice(0, 7)}`);
    this.logger.log(`CI deploy queued behind the active dev operation (${sha.slice(0, 7)})`);
    // The active operation may have finished between the read and this write.
    this.scheduleDrain();
  }

  /** Starts a drain unless one is running; a running drain makes one more pass. */
  scheduleDrain(): void {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    const run = async () => {
      do {
        this.drainAgain = false;
        await this.drainPending().catch((error) =>
          this.logger.warn(`Queued CI deployment drain failed: ${(error as Error).message}`),
        );
      } while (this.drainAgain);
    };
    this.draining = run().finally(() => {
      this.draining = undefined;
    });
  }

  /** Deploys queued CI builds whose dev environment is free again. */
  async drainPending(): Promise<number> {
    const environments = await this.prisma.environment.findMany({
      where: { name: 'dev', pendingCiQueuedAt: { not: null }, activeOperationId: null },
      orderBy: { pendingCiQueuedAt: 'asc' },
      take: PENDING_DRAIN_BATCH,
      select: {
        id: true,
        projectId: true,
        status: true,
        version: true,
        deploymentRequired: true,
        pendingCiVersion: true,
        pendingCiArtifactId: true,
        pendingCiArtifactDigest: true,
        pendingCiQueuedAt: true,
      },
    });
    let started = 0;
    for (const environment of environments) {
      const claimed = await this.prisma.environment.updateMany({
        where: {
          id: environment.id,
          activeOperationId: null,
          pendingCiQueuedAt: environment.pendingCiQueuedAt,
          pendingCiVersion: environment.pendingCiVersion,
        },
        data: {
          pendingCiVersion: null,
          pendingCiArtifactId: null,
          pendingCiArtifactDigest: null,
          pendingCiQueuedAt: null,
        },
      });
      const sha = environment.pendingCiVersion;
      if (claimed.count !== 1 || !sha) continue;
      // A user who cancelled or removed dev does not want the queued build.
      if (environment.status === 'empty') continue;
      if (
        environment.status === 'running' &&
        !environment.deploymentRequired &&
        environment.version?.toLowerCase() === sha
      ) {
        continue;
      }
      const input: CiArtifactInput = {
        artifactId: environment.pendingCiArtifactId ?? undefined,
        artifactDigest: environment.pendingCiArtifactDigest ?? undefined,
      };
      try {
        const project = await this.prisma.project.findUnique({
          where: { id: environment.projectId },
        });
        if (!project) continue;
        const repository = repositoryRef(project);
        const buildArtifact = await this.resolveArtifact(project.id, repository, sha, input);
        if (buildArtifact === 'duplicate') continue;
        await this.startDeploy(project, repository, sha, buildArtifact);
        started += 1;
      } catch (error) {
        if (error instanceof ActiveOperationConflict) {
          // Put it back unless a newer build was queued meanwhile.
          await this.prisma.environment.updateMany({
            where: { id: environment.id, pendingCiQueuedAt: null },
            data: {
              pendingCiVersion: sha,
              pendingCiArtifactId: environment.pendingCiArtifactId,
              pendingCiArtifactDigest: environment.pendingCiArtifactDigest,
              pendingCiQueuedAt: environment.pendingCiQueuedAt,
            },
          });
          continue;
        }
        this.logger.warn(
          `Queued CI deployment of ${sha.slice(0, 7)} failed to start: ${(error as Error).message}`,
        );
      }
    }
    return started;
  }

  private async setLastCommit(projectId: string, lastCommit: string): Promise<void> {
    await this.prisma.project.update({ where: { id: projectId }, data: { lastCommit } });
  }

  private async publishCiFailure(
    project: {
      id: string;
      lastCommit: string;
    },
    dev: {
      id: string;
      status: string;
      activeOperationId: string | null;
    } | null,
    repository: ScmRepositoryRef,
    retryTag: string,
    isRetry: boolean,
    sha: string,
    ciStatus: string,
  ): Promise<void> {
    const reason =
      `CI did not produce a deployable image (CI result: ${ciStatus}). ` +
      'Open the SCM run logs, fix the failed job and run again.';
    const scm = this.workspaceScm.provider(repository.provider);

    if (!dev) {
      if (isRetry) {
        const actor = await this.resolveActor(project.id);
        await scm.deleteTag(repository, retryTag, actor).catch(() => undefined);
      }
      await this.prisma.project.update({
        where: { id: project.id },
        data: { lastCommit: `ci: failed ${sha.slice(0, 7)}` },
      });
      this.logger.warn(`CI failed before artifact verification: ${repository.fullName}`);
      return;
    }

    if (isRetry) {
      const actor = await this.resolveActor(project.id);
      try {
        const operation = dev.activeOperationId
          ? await this.prisma.deploymentOperation.findUnique({
              where: { id: dev.activeOperationId },
            })
          : null;
        if (
          !operation ||
          operation.kind !== 'ci-retry' ||
          operation.status !== 'running' ||
          operation.version !== sha
        ) {
          this.logger.log(
            `Ignoring stale failed CI retry for ${repository.fullName} (${retryTag})`,
          );
          return;
        }
        await this.prisma.environment.updateMany({
          where: { id: dev.id, activeOperationId: operation.id },
          data: {
            status: 'failed',
            statusReason: reason,
            deploymentRequired: true,
            activeOperationId: null,
          },
        });
        await this.operations.complete(operation.id, 'failed', reason);
      } finally {
        await scm.deleteTag(repository, retryTag, actor);
      }
    } else {
      if (dev.status === 'empty' && project.lastCommit !== 'import: existing repository') {
        this.logger.log(
          `Ignoring failed CI callback for disabled dev environment: ${repository.fullName}`,
        );
        return;
      }
      if (dev.activeOperationId) {
        // The active operation keeps dev; a queued older build stays queued.
        await this.setLastCommit(project.id, `ci: failed ${sha.slice(0, 7)}`);
        this.logger.warn(
          `CI failed while dev was busy: ${repository.fullName} (${ciStatus}); nothing recorded`,
        );
        return;
      }
      let operationId: string;
      try {
        operationId = await this.operations.begin(
          project.id,
          'dev',
          'ci-deploy',
          sha.toLowerCase(),
        );
      } catch (error) {
        if (!(error instanceof ActiveOperationConflict)) throw error;
        await this.setLastCommit(project.id, `ci: failed ${sha.slice(0, 7)}`);
        return;
      }
      const finalStatus = ['running', 'stopped'].includes(dev.status) ? dev.status : 'failed';
      await this.prisma.environment.updateMany({
        where: { id: dev.id, activeOperationId: operationId },
        data: {
          status: finalStatus,
          statusReason: reason,
          deploymentRequired: true,
          activeOperationId: null,
        },
      });
      await this.operations.complete(operationId, 'failed', reason);
    }
    await this.prisma.project.update({
      where: { id: project.id },
      data: { lastCommit: `ci: failed ${sha.slice(0, 7)}` },
    });
    this.logger.warn(`CI failed before publication: ${repository.fullName} (${ciStatus})`);
  }

  private async resolveArtifact(
    projectId: string,
    repository: ScmRepositoryRef,
    sha: string,
    input: CiArtifactInput,
  ): Promise<ScmBuildArtifact | null | 'duplicate'> {
    if (repository.provider !== 'github') return null;
    if (!input.artifactId || !input.artifactDigest) {
      throw new BadRequestException(
        'GitHub CI deploy requires an immutable artifact id and SHA-256 digest',
      );
    }
    const scm = this.workspaceScm.provider(repository.provider);
    if (!scm.resolveBuildArtifact || !scm.downloadBuildArtifact) {
      throw new BadRequestException('The GitHub artifact source is not configured');
    }
    let artifact: ScmBuildArtifact;
    try {
      artifact = await scm.resolveBuildArtifact(repository, {
        providerArtifactId: input.artifactId,
        digest: input.artifactDigest,
        commitSha: sha,
        expectedName: 'initpad-image.tar',
      });
    } catch (error) {
      throw new BadRequestException(`Build artifact rejected: ${(error as Error).message}`);
    }
    const replay = await this.prisma.buildArtifact.findUnique({
      where: {
        sourceProvider_providerArtifactId: {
          sourceProvider: artifact.provider,
          providerArtifactId: artifact.providerArtifactId,
        },
      },
    });
    if (!replay) return artifact;
    if (replay.projectId !== projectId || replay.commitSha !== sha.toLowerCase()) {
      throw new BadRequestException('Build artifact is already bound to another deployment');
    }
    if (replay.status !== 'failed') {
      this.logger.log(`Ignoring duplicate CI artifact callback ${artifact.providerArtifactId}`);
      return 'duplicate';
    }
    return artifact;
  }

  private assertRepositoryCoordinates(repo: string): void {
    const coordinates = repo.split('/');
    if (coordinates.length !== 2 || coordinates.some((part) => !part)) {
      throw new BadRequestException('Invalid repo');
    }
  }
}
