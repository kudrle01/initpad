import { ConflictException, Logger } from '@nestjs/common';
import type { BuildArtifact } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArtifactStore, artifactObjectKey } from '../artifacts/artifact-store';
import { config } from '../config';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmRepositoryRef } from '../scm/scm-provider';
import {
  serializableCapacityTransaction,
  WorkspaceCapacityService,
} from '../workspaces/workspace-capacity.service';
import { ProjectArtifactExecutionLease } from './project-artifact-execution-lease';
import { registryImageRef } from './project-deployment-identity';

const CAPTURE_WAIT_MS = 95_000;
const CAPTURE_POLL_MS = 500;

type StaleAvailableArtifact = Pick<
  BuildArtifact,
  'id' | 'updatedAt' | 'ingestionGeneration' | 'storageRef'
>;

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Captures a Gitea OCI image as the same durable artifact used by Agent delivery. */
export class ProjectRegistryArtifactCapture {
  private readonly logger = new Logger('ProjectRegistryArtifactCapture');
  private readonly capacity: WorkspaceCapacityService;
  private readonly execution: ProjectArtifactExecutionLease;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ArtifactStore,
    private readonly deployment: DeploymentService,
  ) {
    this.capacity = new WorkspaceCapacityService(prisma);
    this.execution = new ProjectArtifactExecutionLease(prisma);
  }

  async capture(
    repository: ScmRepositoryRef,
    project: { id: string; workspaceId: string },
    operationId: string | null,
    version: string,
  ): Promise<BuildArtifact> {
    if (!this.store.durable) {
      throw new Error(
        'Verified Gitea deployment requires durable artifact storage; configure the S3/MinIO artifact bucket',
      );
    }
    const normalizedVersion = version.toLowerCase();
    const providerArtifactId = `${project.id}:${normalizedVersion}`;
    const unique = {
      sourceProvider_providerArtifactId: {
        sourceProvider: 'gitea-oci',
        providerArtifactId,
      },
    } as const;
    const existing = await this.prisma.buildArtifact.findUnique({ where: unique });
    if (existing?.projectId !== undefined && existing.projectId !== project.id) {
      throw new Error('Registry artifact identity is already bound to another project');
    }
    if (
      existing?.status === 'available' &&
      existing.storageKind === 'object-store' &&
      existing.storageRef &&
      (await this.store.head(existing.storageRef))?.sizeBytes === Number(existing.sizeBytes)
    ) {
      if (operationId) await this.bindOperationArtifact(operationId, project.id, existing.id);
      return existing;
    }
    const staleAvailableArtifact: StaleAvailableArtifact | null =
      existing?.status === 'available'
        ? {
            id: existing.id,
            updatedAt: existing.updatedAt,
            ingestionGeneration: existing.ingestionGeneration,
            storageRef: existing.storageRef,
          }
        : null;

    const dir = mkdtempSync(join(tmpdir(), 'initpad-registry-artifact-'));
    const filePath = join(dir, 'image.tar');
    const imageRef = registryImageRef(repository, normalizedVersion);
    try {
      await this.deployment.saveImageArchive(imageRef, filePath);
      const [digest, metadata] = await Promise.all([this.fileSha256(filePath), stat(filePath)]);
      const reserved = await this.reserve(
        project,
        providerArtifactId,
        normalizedVersion,
        digest,
        metadata.size,
        staleAvailableArtifact,
      );
      if (reserved.status === 'available') {
        if (
          staleAvailableArtifact?.storageRef &&
          staleAvailableArtifact.storageRef !== reserved.storageRef
        ) {
          await this.store.delete(staleAvailableArtifact.storageRef).catch(() => undefined);
        }
        if (operationId) await this.bindOperationArtifact(operationId, project.id, reserved.id);
        return reserved;
      }

      const execution = await this.execution.run(
        { projectId: project.id, sourceProvider: 'gitea-oci', providerArtifactId },
        async (context) => {
          const objectKey = artifactObjectKey({
            workspaceId: project.workspaceId,
            projectId: project.id,
            artifactId: context.id,
            digest,
          });
          try {
            await this.store.put(objectKey, filePath, {
              contentType: 'application/x-tar',
              sizeBytes: metadata.size,
            });
            const uploaded = await this.store.head(objectKey);
            if (!uploaded || uploaded.sizeBytes !== metadata.size) {
              throw new Error('Registry artifact upload could not be confirmed in object storage');
            }
            await this.execution.assert(context);
            const published = await this.prisma.buildArtifact.updateMany({
              where: this.execution.fence(context, project.id),
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
              throw new ConflictException('Registry artifact publication lost its execution fence');
            }
            this.execution.complete(context);
            return this.prisma.buildArtifact.findUniqueOrThrow({ where: { id: context.id } });
          } catch (error) {
            if (context.completed) throw error;
            try {
              await this.execution.assert(context);
            } catch (leaseError) {
              this.logger.warn(
                `Stale registry capture stopped for ${repository.fullName}: ${(leaseError as Error).message}`,
              );
              throw leaseError;
            }
            await this.store.delete(objectKey).catch(() => undefined);
            const failed = await this.prisma.buildArtifact.updateMany({
              where: this.execution.fence(context, project.id),
              data: {
                status: 'failed',
                error: (error as Error).message,
                storageKind: null,
                storageRef: null,
                ingestionOwner: null,
                ingestionLeaseExpiresAt: null,
              },
            });
            if (failed.count === 1) this.execution.complete(context);
            throw error;
          }
        },
      );
      const artifact = execution.acquired
        ? execution.value
        : await this.waitForAvailable(project.id, providerArtifactId);
      if (
        staleAvailableArtifact?.storageRef &&
        staleAvailableArtifact.storageRef !== artifact.storageRef
      ) {
        await this.store.delete(staleAvailableArtifact.storageRef).catch(() => undefined);
      }
      if (operationId) await this.bindOperationArtifact(operationId, project.id, artifact.id);
      this.logger.log(`Captured registry image ${imageRef} for verified delivery`);
      return artifact;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async reserve(
    project: { id: string; workspaceId: string },
    providerArtifactId: string,
    commitSha: string,
    digest: string,
    sizeBytes: number,
    staleAvailableArtifact: StaleAvailableArtifact | null,
  ): Promise<BuildArtifact> {
    const unique = {
      sourceProvider_providerArtifactId: {
        sourceProvider: 'gitea-oci',
        providerArtifactId,
      },
    } as const;
    const reserve = () =>
      serializableCapacityTransaction(this.prisma, async (tx) => {
        const current = await tx.buildArtifact.findUnique({ where: unique });
        if (current) {
          if (current.projectId !== project.id || current.commitSha !== commitSha) {
            throw new Error('Registry artifact identity is already bound to another project');
          }
          if (current.digest !== digest || current.sizeBytes !== BigInt(sizeBytes)) {
            throw new Error('Registry image bytes changed for an existing immutable commit');
          }
          if (['accepted', 'ingesting'].includes(current.status)) return current;
          // A different worker may have completed while this process exported
          // the local archive. Only reopen the exact row whose object was
          // already proven missing before the export started.
          if (current.status === 'available') {
            const unchangedStaleRevision =
              staleAvailableArtifact !== null &&
              current.id === staleAvailableArtifact.id &&
              current.updatedAt.getTime() === staleAvailableArtifact.updatedAt.getTime() &&
              current.ingestionGeneration === staleAvailableArtifact.ingestionGeneration &&
              current.storageRef === staleAvailableArtifact.storageRef;
            if (!unchangedStaleRevision) return current;
          }
          await this.capacity.assertAvailable(
            project.workspaceId,
            'artifactBytes',
            current.status === 'available' ? 0n : BigInt(sizeBytes),
            tx,
          );
          return tx.buildArtifact.update({
            where: { id: current.id },
            data: {
              status: 'accepted',
              storageKind: null,
              storageRef: null,
              error: null,
              ingestionOwner: null,
              ingestionLeaseExpiresAt: null,
            },
          });
        }

        await this.capacity.assertAvailable(
          project.workspaceId,
          'artifactBytes',
          BigInt(sizeBytes),
          tx,
        );
        return tx.buildArtifact.create({
          data: {
            projectId: project.id,
            sourceProvider: 'gitea-oci',
            providerArtifactId,
            providerRunId: '',
            commitSha,
            name: 'initpad-image.tar',
            digest,
            sizeBytes: BigInt(sizeBytes),
            expiresAt: new Date(Date.now() + config.artifactStore.retentionDays * 86_400_000),
          },
        });
      });
    try {
      return await reserve();
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const winner = await this.prisma.buildArtifact.findUnique({ where: unique });
      if (!winner || winner.projectId !== project.id) throw error;
      if (
        winner.commitSha !== commitSha ||
        winner.digest !== digest ||
        winner.sizeBytes !== BigInt(sizeBytes)
      ) {
        if (error instanceof Error) {
          error.message = `Registry image bytes changed during concurrent artifact reservation: ${error.message}`;
        }
        throw error;
      }
      return winner;
    }
  }

  private async waitForAvailable(
    projectId: string,
    providerArtifactId: string,
  ): Promise<BuildArtifact> {
    const deadline = Date.now() + CAPTURE_WAIT_MS;
    while (Date.now() < deadline) {
      const artifact = await this.prisma.buildArtifact.findUnique({
        where: {
          sourceProvider_providerArtifactId: {
            sourceProvider: 'gitea-oci',
            providerArtifactId,
          },
        },
      });
      if (!artifact || artifact.projectId !== projectId) {
        throw new Error('Registry artifact reservation vanished during capture');
      }
      if (artifact.status === 'available') return artifact;
      if (artifact.status === 'failed') {
        throw new Error(artifact.error ?? 'Registry artifact capture failed');
      }
      await delay(CAPTURE_POLL_MS);
    }
    throw new ConflictException(
      'Registry artifact capture is still running on another API replica',
    );
  }

  private fileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async bindOperationArtifact(
    operationId: string,
    projectId: string,
    buildArtifactId: string,
  ): Promise<void> {
    const bound = await this.prisma.deploymentOperation.updateMany({
      where: { id: operationId, status: 'running', environment: { projectId } },
      data: { buildArtifactId },
    });
    if (bound.count !== 1) throw new Error('Deployment operation is no longer active');
  }
}
