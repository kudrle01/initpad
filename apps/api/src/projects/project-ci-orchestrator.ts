import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { tokenMatches } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import {
  repositoryRef,
  ScmActor,
  ScmBuildArtifact,
  ScmRepositoryRef,
} from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { CI_RUNNING_REASON } from './ci-state';
import { ProjectArtifactIngestion } from './project-artifact-ingestion';
import { ProjectDeploymentOperations } from './project-deployment-operations';

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

type ScheduleDeployment = (
  projectId: string,
  version: string,
  kind: string,
) => Promise<void>;

/**
 * Repository-authenticated CI callback state machine. It validates the source
 * event, handles retry-tag ownership and decides whether an immutable artifact
 * is ingested or an existing registry image can deploy directly.
 */
export class ProjectCiOrchestrator {
  private readonly logger = new Logger('ProjectCiOrchestrator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly operations: ProjectDeploymentOperations,
    private readonly ingestion: ProjectArtifactIngestion,
    private readonly resolveActor: (projectId: string) => Promise<ScmActor>,
    private readonly deployInBackground: DeployInBackground,
    private readonly scheduleDeployment: ScheduleDeployment,
  ) {}

  async started(repo: string, sha: string, ref: string, token: string): Promise<void> {
    this.assertRepositoryCoordinates(repo);
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new BadRequestException('CI start requires a full 40-character commit SHA');
    }

    const candidates = await this.prisma.project.findMany({
      where: { scmFullName: repo },
    });
    const project = candidates.find((candidate) =>
      tokenMatches(token, candidate.ciDeployTokenHash),
    );
    if (!project) {
      if (candidates.length > 0) {
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
    const candidates = await this.prisma.project.findMany({
      where: { scmFullName: repo },
    });
    const project = candidates.find((candidate) =>
      tokenMatches(token, candidate.ciDeployTokenHash),
    );
    if (!project) {
      if (candidates.length > 0) {
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
    if (!dev) throw new BadRequestException("Project has no 'dev' environment");

    const ciStatus = (artifactInput.ciStatus || 'success').trim().toLowerCase();
    if (!['success', 'failure', 'cancelled', 'skipped'].includes(ciStatus)) {
      throw new BadRequestException(`Unsupported CI result '${ciStatus}'`);
    }
    if (ciStatus !== 'success') {
      await this.publishCiFailure(project, dev, repository, retryTag, isRetry, sha, ciStatus);
      return;
    }

    const buildArtifact = await this.resolveArtifact(
      project.id,
      repository,
      sha,
      artifactInput,
    );
    if (buildArtifact === 'duplicate') return;

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

    const version = sha || '0.1.0';
    await this.prisma.project.update({
      where: { id: project.id },
      data: { lastCommit: `ci: deploy ${version.slice(0, 7)}` },
    });
    if (buildArtifact) {
      const operationId = await this.operations.begin(
        project.id,
        'dev',
        'ci-deploy',
        version,
      );
      await this.ingestion.queue(project.id, repository, buildArtifact, operationId);
    } else {
      await this.scheduleDeployment(project.id, version, 'ci-deploy');
    }
    this.logger.log(`CI deploy: ${repo} → dev (${version})`);
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
    },
    repository: ScmRepositoryRef,
    retryTag: string,
    isRetry: boolean,
    sha: string,
    ciStatus: string,
  ): Promise<void> {
    const reason =
      `CI did not produce a deployable image (docker job: ${ciStatus}). ` +
      'Open the SCM run logs, fix the failed job and run again.';
    const scm = this.workspaceScm.provider(repository.provider);

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
          this.logger.log(`Ignoring stale failed CI retry for ${repository.fullName} (${retryTag})`);
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
      const operationId = await this.operations.begin(
        project.id,
        'dev',
        'ci-deploy',
        sha.toLowerCase(),
      );
      const finalStatus = ['running', 'stopped'].includes(dev.status)
        ? dev.status
        : 'failed';
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
