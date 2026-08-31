import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EnvName, RollbackPreview } from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';
import { DEPLOYMENT_PUBLICATION_KINDS } from './deployment-publications';

const IMMUTABLE_VERSION = /^[a-f0-9]{40}$/i;

type ScheduleRollback = (
  projectId: string,
  environment: EnvName,
  version: string,
  buildArtifactId: string | null,
) => Promise<void>;

/** Selects and executes a previously verified publication without invoking CI. */
export class ProjectRollback {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleRollback,
  ) {}

  async preview(projectId: string, environmentName: EnvName): Promise<RollbackPreview | null> {
    const environment = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: environmentName } },
      include: {
        target: { select: { id: true, name: true, scope: true } },
        buildArtifact: {
          select: { id: true, sourceProvider: true, digest: true, providerRunId: true },
        },
        configVars: {
          orderBy: { key: 'asc' },
          select: { key: true, updatedAt: true },
        },
        project: { select: { scmProvider: true } },
      },
    });
    if (!environment) throw new NotFoundException(`Environment '${environmentName}' not found`);
    if (environment.activeOperationId) return null;

    const excludeCurrentPublication = environment.buildArtifactId
      ? { NOT: { buildArtifactId: environment.buildArtifactId } }
      : environment.version
        ? { version: { not: environment.version } }
        : {};
    const publications = await this.prisma.deploymentOperation.findMany({
      where: {
        environmentId: environment.id,
        status: 'succeeded',
        kind: { in: [...DEPLOYMENT_PUBLICATION_KINDS] },
        version: { not: null },
        ...excludeCurrentPublication,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        buildArtifact: {
          select: {
            id: true,
            sourceProvider: true,
            providerRunId: true,
            digest: true,
            status: true,
            storageKind: true,
            storageRef: true,
          },
        },
      },
    });
    const durableArtifactRequired =
      environment.project.scmProvider === 'github'
      || (environment.provider === 'docker' && environment.target?.scope === 'user');
    const candidate = publications.find((operation) => {
      if (!operation.version || !IMMUTABLE_VERSION.test(operation.version)) return false;
      const sameAsCurrent = environment.buildArtifactId
        ? operation.buildArtifactId === environment.buildArtifactId
        : operation.version === environment.version;
      if (sameAsCurrent) return false;
      if (!durableArtifactRequired) return true;
      return Boolean(
        operation.buildArtifact
        && operation.buildArtifact.status === 'available'
        && operation.buildArtifact.storageKind === 'object-store'
        && operation.buildArtifact.storageRef,
      );
    });
    if (!candidate?.version) return null;

    const artifact = candidate.buildArtifact;
    return {
      candidateOperationId: candidate.id,
      environment: environmentName,
      target: environment.target?.name ?? environment.provider,
      currentVersion: environment.version,
      rollbackVersion: candidate.version,
      currentArtifact: environment.buildArtifact
        ? {
            id: environment.buildArtifact.id,
            provider: environment.buildArtifact.sourceProvider,
            digest: environment.buildArtifact.digest,
            runId: environment.buildArtifact.providerRunId,
          }
        : null,
      rollbackArtifact: artifact
        ? {
            id: artifact.id,
            provider: artifact.sourceProvider,
            digest: artifact.digest,
            runId: artifact.providerRunId,
          }
        : null,
      sourceDeployedAt: (candidate.finishedAt ?? candidate.createdAt).toISOString(),
      stateToken: this.stateToken(environment),
    };
  }

  async execute(
    projectId: string,
    environmentName: EnvName,
    candidateOperationId: string,
    stateToken: string,
  ): Promise<void> {
    const preview = await this.preview(projectId, environmentName);
    if (!preview) {
      throw new BadRequestException(
        `Environment '${environmentName}' has no available previous verified deployment`,
      );
    }
    if (preview.stateToken !== stateToken) {
      throw new ConflictException(
        'Environment, target, or configuration changed after rollback confirmation was opened. Review it again.',
      );
    }
    if (preview.candidateOperationId !== candidateOperationId) {
      throw new ConflictException('The previous verified deployment changed. Review rollback again.');
    }
    await this.schedule(
      projectId,
      environmentName,
      preview.rollbackVersion,
      preview.rollbackArtifact?.id ?? null,
    );
  }

  private stateToken(environment: {
    id: string;
    targetId: string | null;
    version: string | null;
    buildArtifactId: string | null;
    status: string;
    deploymentRequired: boolean;
    activeOperationId: string | null;
    configVars: Array<{ key: string; updatedAt: Date }>;
  }): string {
    return createHash('sha256')
      .update(JSON.stringify([
        environment.id,
        environment.targetId,
        environment.version,
        environment.buildArtifactId,
        environment.status,
        environment.deploymentRequired,
        environment.activeOperationId,
        environment.configVars.map(({ key, updatedAt }) => [key, updatedAt.toISOString()]),
      ]))
      .digest('hex');
  }
}
