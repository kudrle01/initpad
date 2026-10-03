import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ArtifactStore, artifactObjectKey } from '../artifacts/artifact-store';
import { assertImageArchiveIdentity } from '../artifacts/image-archive';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmBuildArtifact, ScmProvider, ScmRepositoryRef } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { artifactImageRef } from './project-deployment-identity';
import { ProjectDeploymentOperations } from './project-deployment-operations';
import {
  serializableCapacityTransaction,
  WorkspaceCapacityService,
} from '../workspaces/workspace-capacity.service';

type DeployVerifiedArtifact = (
  projectId: string,
  version: string,
  operationId: string,
) => Promise<void>;

const INGESTION_LEASE_MS = 90_000;
const INGESTION_RENEW_MS = 30_000;
const LEGACY_INGESTION_GRACE_MS = INGESTION_LEASE_MS;

type IngestionClaim = { id: string; generation: number };
type IngestionContext = IngestionClaim & {
  lost: Error | null;
  completed: boolean;
};

/**
 * Owns the durable handoff between an SCM build artifact and deployment.
 * Provider bytes are verified before object storage or the Docker daemon may
 * accept them; every partial resource is compensated on failure.
 */
export class ProjectArtifactIngestion {
  private readonly logger = new Logger('ProjectArtifactIngestion');
  private readonly capacity: WorkspaceCapacityService;
  private readonly instanceId = randomUUID();
  private readonly localExecutions = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly deployment: DeploymentService,
    private readonly store: ArtifactStore,
    private readonly operations: ProjectDeploymentOperations,
    private readonly deployVerifiedArtifact: DeployVerifiedArtifact,
  ) {
    this.capacity = new WorkspaceCapacityService(prisma);
  }

  async recoverInterrupted(): Promise<void> {
    try {
      const now = new Date();
      const legacyCutoff = new Date(now.getTime() - LEGACY_INGESTION_GRACE_MS);
      const interrupted = await this.prisma.buildArtifact.findMany({
        where: {
          OR: [
            {
              status: 'ingesting',
              OR: [
                { ingestionLeaseExpiresAt: { lte: now } },
                {
                  ingestionOwner: null,
                  ingestionLeaseExpiresAt: null,
                  createdAt: { lte: legacyCutoff },
                },
              ],
            },
            {
              status: 'accepted',
              ingestionOwner: null,
              ingestionLeaseExpiresAt: null,
              createdAt: { lte: legacyCutoff },
            },
          ],
        },
        select: {
          id: true,
          status: true,
          projectId: true,
          commitSha: true,
          createdAt: true,
          ingestionOwner: true,
          ingestionGeneration: true,
          ingestionLeaseExpiresAt: true,
          operations: {
            where: { status: 'running', finishedAt: null },
            select: { id: true },
          },
        },
      });
      let recovered = 0;
      for (const artifact of interrupted) {
        // Deployment operation recovery runs first and owns environment state.
        // A still-running operation may be healthy on another replica, so the
        // artifact must remain untouched until that operation is terminal.
        if (artifact.operations.length > 0) continue;
        const reason =
          'Artifact ingestion was interrupted by a control-plane restart; run CI again';
        const claimed = await this.prisma.buildArtifact.updateMany({
          where: {
            id: artifact.id,
            status: artifact.status,
            ingestionOwner: artifact.ingestionOwner,
            ingestionGeneration: artifact.ingestionGeneration,
            OR: [
              { ingestionLeaseExpiresAt: { lte: now } },
              {
                ingestionOwner: null,
                ingestionLeaseExpiresAt: null,
                createdAt: { lte: legacyCutoff },
              },
            ],
          },
          data: {
            status: 'failed',
            error: reason,
            storageKind: null,
            storageRef: null,
            ingestionOwner: null,
            ingestionLeaseExpiresAt: null,
          },
        });
        if (claimed.count === 1) recovered += 1;
      }
      if (recovered > 0) {
        this.logger.warn(`Recovered ${recovered} interrupted build artifact ingestion(s)`);
      }
    } catch (error) {
      this.logger.warn(`Build artifact recovery skipped: ${(error as Error).message}`);
    }
  }

  async queue(
    projectId: string,
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
    operationId: string,
  ): Promise<void> {
    try {
      const accepted = await this.accept(projectId, artifact);
      await this.prisma.deploymentOperation.update({
        where: { id: operationId },
        data: { buildArtifactId: accepted.id },
      });
      await this.operations.advancePhase(operationId, 'assigned', 'Build artifact accepted');
    } catch (error) {
      const message = `Could not record build artifact: ${(error as Error).message}`;
      await this.prisma.environment
        .updateMany({
          where: { projectId, name: 'dev', activeOperationId: operationId },
          data: { status: 'failed', statusReason: message, activeOperationId: null },
        })
        .catch(() => undefined);
      await this.operations.complete(operationId, 'failed', message);
      throw error;
    }
    void this.ingest(projectId, repository, artifact, operationId);
  }

  /** Verifies and stores a CI artifact without publishing it to an environment. */
  async queueVerification(
    projectId: string,
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
  ): Promise<void> {
    await this.accept(projectId, artifact);
    void this.ingest(projectId, repository, artifact, null);
  }

  async ingest(
    projectId: string,
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
    operationId: string | null,
  ): Promise<void> {
    const task = () => this.runWithIngestionLease(projectId, repository, artifact, operationId);
    try {
      if (operationId) await this.operations.runWithExecutionLease(operationId, task);
      else await task();
    } catch (error) {
      this.logger.warn(
        `Artifact ingestion execution stopped for ${repository.fullName}: ${(error as Error).message}`,
      );
    }
  }

  private async runWithIngestionLease(
    projectId: string,
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
    operationId: string | null,
  ): Promise<void> {
    const localKey = `${artifact.provider}:${artifact.providerArtifactId}`;
    if (this.localExecutions.has(localKey)) return;
    const claim = await this.claimExecution(projectId, artifact);
    if (!claim) return;

    const context: IngestionContext = { ...claim, lost: null, completed: false };
    this.localExecutions.add(localKey);
    const timer = setInterval(() => {
      void this.renewExecution(context).catch((error) => {
        context.lost =
          error instanceof Error ? error : new ConflictException('Artifact ingestion lease lost');
      });
    }, INGESTION_RENEW_MS);
    timer.unref();

    try {
      await this.ingestOwned(projectId, repository, artifact, operationId, context);
    } finally {
      clearInterval(timer);
      this.localExecutions.delete(localKey);
      if (!context.completed) await this.releaseExecution(context).catch(() => undefined);
    }
  }

  private async ingestOwned(
    projectId: string,
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
    operationId: string | null,
    context: IngestionContext,
  ): Promise<void> {
    if (operationId) {
      await this.operations.advancePhase(
        operationId,
        'running',
        'Downloading and verifying tested image',
      );
      await this.prisma.environment.updateMany({
        where: { projectId, name: 'dev', activeOperationId: operationId },
        data: { statusReason: 'Downloading and verifying tested image' },
      });
      await this.prisma.deploymentOperation.updateMany({
        where: { id: operationId, status: 'running' },
        data: { message: 'Downloading and verifying tested image' },
      });
    }
    const scm = this.workspaceScm.provider(repository.provider);
    let download: Awaited<ReturnType<NonNullable<ScmProvider['downloadBuildArtifact']>>> | null =
      null;
    let objectKey: string | null = null;
    try {
      if (!scm.downloadBuildArtifact) throw new Error('Artifact download is unavailable');
      download = await scm.downloadBuildArtifact(repository, artifact);
      await this.assertExecution(context);
      const imageRef = artifactImageRef(repository, artifact);
      await assertImageArchiveIdentity(download.filePath, imageRef);
      await this.assertExecution(context);

      objectKey = await this.objectKey(projectId, artifact);
      await this.store.put(objectKey, download.filePath, {
        sizeBytes: Number(artifact.sizeBytes),
        contentType: 'application/x-tar',
      });
      const head = await this.store.head(objectKey);
      if (!head) throw new Error('Artifact upload could not be confirmed in object storage');
      await this.assertExecution(context);

      await this.deployment.loadImageArchive(download.filePath, imageRef);
      await this.assertExecution(context);
      const published = await this.prisma.buildArtifact.updateMany({
        where: {
          id: context.id,
          projectId,
          status: 'ingesting',
          ingestionOwner: this.instanceId,
          ingestionGeneration: context.generation,
        },
        data: {
          status: 'available',
          storageKind: 'object-store',
          storageRef: objectKey,
          error: null,
          ingestionOwner: null,
          ingestionLeaseExpiresAt: null,
        },
      });
      if (published.count !== 1) {
        throw new ConflictException('Artifact publication lost its execution fence');
      }
      context.completed = true;
      if (operationId && (await this.operations.cancelled(operationId))) {
        await this.prisma.environment.updateMany({
          where: { projectId, name: 'dev', activeOperationId: operationId },
          data: {
            status: 'empty',
            version: null,
            buildArtifactId: null,
            statusReason: null,
            activeOperationId: null,
          },
        });
        await this.operations.complete(
          operationId,
          'cancelled',
          'Cancelled during artifact ingestion',
        );
        return;
      }
      if (operationId) {
        await this.deployVerifiedArtifact(projectId, artifact.commitSha, operationId);
      } else {
        await this.prisma.project.update({
          where: { id: projectId },
          data: { lastCommit: `ci: verified ${artifact.commitSha.slice(0, 7)}` },
        });
      }
    } catch (error) {
      const message = (error as Error).message;
      if (context.completed) {
        this.logger.error(
          `Post-ingestion publication failed for ${repository.fullName}: ${message}`,
        );
        throw error instanceof Error ? error : new Error(message);
      }
      try {
        await this.assertExecution(context);
      } catch (leaseError) {
        this.logger.warn(
          `Stale artifact worker stopped for ${repository.fullName}: ${(leaseError as Error).message}`,
        );
        return;
      }
      if (objectKey) {
        await this.store
          .delete(objectKey)
          .catch((cleanupError) =>
            this.logger.warn(
              `Could not clean up partial artifact object: ${(cleanupError as Error).message}`,
            ),
          );
      }
      const failed = await this.prisma.buildArtifact.updateMany({
        where: {
          id: context.id,
          projectId,
          status: 'ingesting',
          ingestionOwner: this.instanceId,
          ingestionGeneration: context.generation,
        },
        data: {
          status: 'failed',
          error: message,
          storageKind: null,
          storageRef: null,
          ingestionOwner: null,
          ingestionLeaseExpiresAt: null,
        },
      });
      if (failed.count !== 1) return;
      context.completed = true;
      if (operationId) {
        await this.prisma.environment
          .updateMany({
            where: { projectId, name: 'dev', activeOperationId: operationId },
            data: { status: 'failed', statusReason: message, activeOperationId: null },
          })
          .catch(() => undefined);
        await this.operations.complete(operationId, 'failed', message);
      } else {
        await this.prisma.project
          .update({
            where: { id: projectId },
            data: { lastCommit: `ci: artifact failed ${artifact.commitSha.slice(0, 7)}` },
          })
          .catch(() => undefined);
      }
      this.logger.error(`Artifact ingestion failed for ${repository.fullName}: ${message}`);
    } finally {
      try {
        download?.cleanup();
      } catch (error) {
        this.logger.warn(`Could not clean up downloaded artifact: ${(error as Error).message}`);
      }
    }
  }

  private async claimExecution(
    projectId: string,
    artifact: Pick<ScmBuildArtifact, 'provider' | 'providerArtifactId'>,
  ): Promise<IngestionClaim | null> {
    const rows = await this.prisma.$queryRaw<IngestionClaim[]>(Prisma.sql`
      UPDATE "BuildArtifact"
      SET
        "status" = 'ingesting',
        "error" = NULL,
        "ingestionOwner" = ${this.instanceId},
        "ingestionGeneration" = "ingestionGeneration" + 1,
        "ingestionLeaseExpiresAt" = CURRENT_TIMESTAMP
          + (${INGESTION_LEASE_MS} * INTERVAL '1 millisecond')
      WHERE "sourceProvider" = ${artifact.provider}
        AND "providerArtifactId" = ${artifact.providerArtifactId}
        AND "projectId" = ${projectId}
        AND "status" IN ('accepted', 'failed')
        AND "ingestionOwner" IS NULL
      RETURNING "id", "ingestionGeneration" AS "generation"
    `);
    return rows[0] ?? null;
  }

  private async assertExecution(context: IngestionContext): Promise<void> {
    if (context.completed) return;
    if (context.lost) throw context.lost;
    await this.renewExecution(context);
    const lost = context.lost as Error | null;
    if (lost) throw lost;
  }

  private async renewExecution(context: IngestionContext): Promise<void> {
    if (context.completed || context.lost) {
      if (context.lost) throw context.lost;
      return;
    }
    const rows = await this.prisma.$queryRaw<IngestionClaim[]>(Prisma.sql`
      UPDATE "BuildArtifact"
      SET
        "ingestionLeaseExpiresAt" = CURRENT_TIMESTAMP
          + (${INGESTION_LEASE_MS} * INTERVAL '1 millisecond')
      WHERE "id" = ${context.id}
        AND "status" = 'ingesting'
        AND "ingestionOwner" = ${this.instanceId}
        AND "ingestionGeneration" = ${context.generation}
        AND "ingestionLeaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING "id", "ingestionGeneration" AS "generation"
    `);
    if (rows.length !== 1) {
      context.lost = new ConflictException('Artifact ingestion lease was lost');
      throw context.lost;
    }
  }

  private async releaseExecution(context: IngestionContext): Promise<void> {
    await this.prisma.buildArtifact.updateMany({
      where: {
        id: context.id,
        status: 'ingesting',
        ingestionOwner: this.instanceId,
        ingestionGeneration: context.generation,
      },
      data: { ingestionOwner: null, ingestionLeaseExpiresAt: null },
    });
  }

  private async accept(projectId: string, artifact: ScmBuildArtifact): Promise<{ id: string }> {
    const identity = {
      sourceProvider: artifact.provider,
      providerArtifactId: artifact.providerArtifactId,
    };
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw new Error('Project for build artifact was not found');

    return serializableCapacityTransaction(this.prisma, async (tx) => {
      const existing = await tx.buildArtifact.findUnique({
        where: {
          sourceProvider_providerArtifactId: identity,
        },
        select: { id: true, projectId: true, commitSha: true, status: true, sizeBytes: true },
      });
      if (existing) {
        if (
          existing.projectId !== projectId ||
          existing.commitSha.toLowerCase() !== artifact.commitSha.toLowerCase()
        ) {
          throw new Error('Build artifact is already bound to another deployment');
        }
        if (!['accepted', 'ingesting', 'available'].includes(existing.status)) {
          await this.capacity.assertAvailable(
            project.workspaceId,
            'artifactBytes',
            existing.sizeBytes,
            tx,
          );
        }
        return tx.buildArtifact.update({
          where: { id: existing.id },
          data: {
            status: 'accepted',
            storageKind: null,
            storageRef: null,
            error: null,
            ingestionOwner: null,
            ingestionLeaseExpiresAt: null,
          },
          select: { id: true },
        });
      }

      await this.capacity.assertAvailable(
        project.workspaceId,
        'artifactBytes',
        BigInt(artifact.sizeBytes),
        tx,
      );
      return tx.buildArtifact.create({
        data: {
          projectId,
          sourceProvider: artifact.provider,
          providerArtifactId: artifact.providerArtifactId,
          providerRunId: artifact.providerRunId,
          commitSha: artifact.commitSha,
          name: artifact.name,
          digest: artifact.digest,
          sizeBytes: BigInt(artifact.sizeBytes),
          expiresAt: artifact.expiresAt,
        },
        select: { id: true },
      });
    });
  }

  private async objectKey(
    projectId: string,
    artifact: Pick<ScmBuildArtifact, 'provider' | 'providerArtifactId' | 'digest'>,
  ): Promise<string> {
    const row = await this.prisma.buildArtifact.findUnique({
      where: {
        sourceProvider_providerArtifactId: {
          sourceProvider: artifact.provider,
          providerArtifactId: artifact.providerArtifactId,
        },
      },
      select: { id: true, project: { select: { workspaceId: true } } },
    });
    if (!row) throw new Error('Build artifact record vanished during ingestion');
    return artifactObjectKey({
      workspaceId: row.project.workspaceId,
      projectId,
      artifactId: row.id,
      digest: artifact.digest,
    });
  }
}
