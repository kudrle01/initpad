import { Logger } from '@nestjs/common';
import { ArtifactStore, artifactObjectKey } from '../artifacts/artifact-store';
import { assertImageArchiveIdentity } from '../artifacts/image-archive';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScmBuildArtifact,
  ScmProvider,
  ScmRepositoryRef,
} from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { artifactImageRef } from './project-deployment-identity';
import { ProjectDeploymentOperations } from './project-deployment-operations';

type DeployVerifiedArtifact = (
  projectId: string,
  version: string,
  operationId: string,
) => Promise<void>;

/**
 * Owns the durable handoff between an SCM build artifact and deployment.
 * Provider bytes are verified before object storage or the Docker daemon may
 * accept them; every partial resource is compensated on failure.
 */
export class ProjectArtifactIngestion {
  private readonly logger = new Logger('ProjectArtifactIngestion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly deployment: DeploymentService,
    private readonly store: ArtifactStore,
    private readonly operations: ProjectDeploymentOperations,
    private readonly deployVerifiedArtifact: DeployVerifiedArtifact,
  ) {}

  async recoverInterrupted(): Promise<void> {
    try {
      const interrupted = await this.prisma.buildArtifact.findMany({
        where: { status: { in: ['accepted', 'ingesting'] } },
        select: { id: true, projectId: true, commitSha: true },
      });
      for (const artifact of interrupted) {
        const reason = 'Artifact ingestion was interrupted by a control-plane restart; run CI again';
        const operations = await this.prisma.deploymentOperation.findMany({
          where: {
            environment: { projectId: artifact.projectId, name: 'dev' },
            version: artifact.commitSha,
            status: 'running',
          },
          select: { id: true },
        });
        await this.prisma.$transaction([
          this.prisma.buildArtifact.update({
            where: { id: artifact.id },
            data: { status: 'failed', error: reason, storageKind: null, storageRef: null },
          }),
          this.prisma.environment.updateMany({
            where: {
              projectId: artifact.projectId,
              name: 'dev',
              activeOperationId: { not: null },
            },
            data: { status: 'failed', statusReason: reason, activeOperationId: null },
          }),
        ]);
        for (const operation of operations) {
          await this.operations.complete(operation.id, 'failed', reason);
        }
      }
      if (interrupted.length > 0) {
        this.logger.warn(`Recovered ${interrupted.length} interrupted build artifact ingestion(s)`);
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

  async ingest(
    projectId: string,
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
    operationId: string,
  ): Promise<void> {
    const claimed = await this.prisma.buildArtifact.updateMany({
      where: {
        sourceProvider: artifact.provider,
        providerArtifactId: artifact.providerArtifactId,
        projectId,
        status: { in: ['accepted', 'failed'] },
      },
      data: { status: 'ingesting', error: null },
    });
    if (claimed.count !== 1) return;
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
    const scm = this.workspaceScm.provider(repository.provider);
    let download: Awaited<
      ReturnType<NonNullable<ScmProvider['downloadBuildArtifact']>>
    > | null = null;
    let objectKey: string | null = null;
    try {
      if (!scm.downloadBuildArtifact) throw new Error('Artifact download is unavailable');
      download = await scm.downloadBuildArtifact(repository, artifact);
      const imageRef = artifactImageRef(repository, artifact);
      await assertImageArchiveIdentity(download.filePath, imageRef);

      objectKey = await this.objectKey(projectId, artifact);
      await this.store.put(objectKey, download.filePath, {
        sizeBytes: Number(artifact.sizeBytes),
        contentType: 'application/x-tar',
      });
      const head = await this.store.head(objectKey);
      if (!head) throw new Error('Artifact upload could not be confirmed in object storage');

      await this.deployment.loadImageArchive(download.filePath, imageRef);
      await this.prisma.buildArtifact.updateMany({
        where: {
          sourceProvider: artifact.provider,
          providerArtifactId: artifact.providerArtifactId,
          projectId,
          status: 'ingesting',
        },
        data: {
          status: 'available',
          storageKind: 'object-store',
          storageRef: objectKey,
          error: null,
        },
      });
      if (await this.operations.cancelled(operationId)) {
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
      await this.deployVerifiedArtifact(projectId, artifact.commitSha, operationId);
    } catch (error) {
      const message = (error as Error).message;
      if (objectKey) {
        await this.store.delete(objectKey).catch((cleanupError) =>
          this.logger.warn(
            `Could not clean up partial artifact object: ${(cleanupError as Error).message}`,
          ),
        );
      }
      await this.prisma.buildArtifact
        .updateMany({
          where: {
            sourceProvider: artifact.provider,
            providerArtifactId: artifact.providerArtifactId,
            projectId,
          },
          data: { status: 'failed', error: message, storageKind: null, storageRef: null },
        })
        .catch(() => undefined);
      await this.prisma.environment
        .updateMany({
          where: { projectId, name: 'dev', activeOperationId: operationId },
          data: { status: 'failed', statusReason: message, activeOperationId: null },
        })
        .catch(() => undefined);
      await this.operations.complete(operationId, 'failed', message);
      this.logger.error(`Artifact ingestion failed for ${repository.fullName}: ${message}`);
    } finally {
      download?.cleanup();
    }
  }

  private async accept(
    projectId: string,
    artifact: ScmBuildArtifact,
  ): Promise<{ id: string }> {
    const identity = {
      sourceProvider: artifact.provider,
      providerArtifactId: artifact.providerArtifactId,
    };
    const existing = await this.prisma.buildArtifact.findUnique({
      where: {
        sourceProvider_providerArtifactId: identity,
      },
      select: { id: true, projectId: true, commitSha: true },
    });
    if (existing) {
      if (
        existing.projectId !== projectId ||
        existing.commitSha.toLowerCase() !== artifact.commitSha.toLowerCase()
      ) {
        throw new Error('Build artifact is already bound to another deployment');
      }
      return this.prisma.buildArtifact.update({
        where: { id: existing.id },
        data: {
          status: 'accepted',
          storageKind: null,
          storageRef: null,
          error: null,
        },
        select: { id: true },
      });
    }
    return this.prisma.buildArtifact.create({
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
