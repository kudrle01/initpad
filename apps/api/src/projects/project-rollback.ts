import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EnvName, RollbackCandidate, RollbackPreview } from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';
import { DEPLOYMENT_PUBLICATION_KINDS } from './deployment-publications';

const IMMUTABLE_VERSION = /^[a-f0-9]{40}$/i;
const ROLLBACK_CANDIDATES = 5;

type ScheduleRollback = (
  projectId: string,
  environment: EnvName,
  version: string,
  buildArtifactId: string | null,
  actorUserId?: string,
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
      take: 50,
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
      environment.project.scmProvider === 'github' ||
      (environment.provider === 'docker' && environment.target?.scope === 'user');
    const eligible = publications.filter((operation) => {
      if (!operation.version || !IMMUTABLE_VERSION.test(operation.version)) return false;
      const sameAsCurrent = environment.buildArtifactId
        ? operation.buildArtifactId === environment.buildArtifactId
        : operation.version === environment.version;
      if (sameAsCurrent) return false;
      if (!durableArtifactRequired) return true;
      return Boolean(
        operation.buildArtifact &&
        operation.buildArtifact.status === 'available' &&
        operation.buildArtifact.storageKind === 'object-store' &&
        operation.buildArtifact.storageRef,
      );
    });
    // One entry per distinct build: redeploying the same artifact twice is
    // not a separate rollback point.
    const seen = new Set<string>();
    const candidates: RollbackCandidate[] = [];
    for (const operation of eligible) {
      const key = operation.buildArtifactId ?? `version:${operation.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const artifact = operation.buildArtifact;
      candidates.push({
        candidateOperationId: operation.id,
        version: operation.version as string,
        artifact: artifact
          ? {
              id: artifact.id,
              provider: artifact.sourceProvider,
              digest: artifact.digest,
              runId: artifact.providerRunId,
            }
          : null,
        deployedAt: (operation.finishedAt ?? operation.createdAt).toISOString(),
      });
      if (candidates.length === ROLLBACK_CANDIDATES) break;
    }
    const [candidate] = candidates;
    if (!candidate) return null;

    return {
      candidateOperationId: candidate.candidateOperationId,
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
      rollbackArtifact: candidate.artifact,
      sourceDeployedAt: candidate.deployedAt,
      stateToken: this.stateToken(environment),
      candidates,
    };
  }

  /** The chosen rollback point, or null when it is no longer offered. */
  static select(preview: RollbackPreview, candidateOperationId: string): RollbackCandidate | null {
    return (
      preview.candidates.find(
        (candidate) => candidate.candidateOperationId === candidateOperationId,
      ) ?? null
    );
  }

  async execute(
    projectId: string,
    environmentName: EnvName,
    candidateOperationId: string,
    stateToken: string,
    actorUserId?: string,
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
    const candidate = ProjectRollback.select(preview, candidateOperationId);
    if (!candidate) {
      throw new ConflictException(
        'The selected verified deployment is no longer available. Review rollback again.',
      );
    }
    await this.schedule(
      projectId,
      environmentName,
      candidate.version,
      candidate.artifact?.id ?? null,
      actorUserId,
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
      .update(
        JSON.stringify([
          environment.id,
          environment.targetId,
          environment.version,
          environment.buildArtifactId,
          environment.status,
          environment.deploymentRequired,
          environment.activeOperationId,
          environment.configVars.map(({ key, updatedAt }) => [key, updatedAt.toISOString()]),
        ]),
      )
      .digest('hex');
  }
}
