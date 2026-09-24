import { Logger, NotFoundException } from '@nestjs/common';
import type { BuildArtifact } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, mkdtempSync, rmSync } from 'fs';
import { stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ArtifactStore, artifactObjectKey } from '../artifacts/artifact-store';
import { config } from '../config';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmRepositoryRef } from '../scm/scm-provider';
import { DEPLOYMENT_PUBLICATION_KINDS } from './deployment-publications';
import { artifactImageRef, registryImageRef } from './project-deployment-identity';

/**
 * Durable artifact lifecycle owned by the project domain. CI ingestion stays
 * outside this boundary; availability, retention, download grants and
 * project-object cleanup live here together.
 */
export class ProjectArtifactLifecycle {
  private readonly logger = new Logger('ProjectArtifactLifecycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ArtifactStore,
    private readonly deployment: DeploymentService,
  ) {}

  /**
   * Ensures the exact verified image is available in the local runtime. The
   * durable object store remains the source of truth when the daemon cache was
   * pruned or the control plane restarted.
   */
  async ensureImageAvailable(
    repository: ScmRepositoryRef,
    projectId: string,
    buildArtifactId: string,
  ): Promise<boolean> {
    const artifact = await this.prisma.buildArtifact.findFirst({
      where: {
        id: buildArtifactId,
        projectId,
        status: 'available',
        storageKind: 'object-store',
      },
    });
    if (!artifact?.storageRef) return false;
    const imageRef = artifactImageRef(repository, {
      commitSha: artifact.commitSha,
      providerRunId: artifact.providerRunId,
    });
    if (await this.deployment.hasImage(imageRef)) return true;
    return this.rehydrateImage(artifact.storageRef, imageRef, artifact.digest);
  }

  async rehydrateImage(
    objectKey: string,
    imageRef: string,
    expectedDigest: string,
  ): Promise<boolean> {
    const dir = mkdtempSync(join(tmpdir(), 'initpad-rehydrate-'));
    const filePath = join(dir, 'image.tar');
    try {
      await this.store.getToFile(objectKey, filePath);
      const digest = await this.fileSha256(filePath);
      if (digest !== expectedDigest.toLowerCase().replace(/^sha256:/, '')) {
        throw new Error('Rehydrated artifact digest does not match the recorded value');
      }
      await this.deployment.loadImageArchive(filePath, imageRef);
      this.logger.log(`Rehydrated verified image ${imageRef} from object storage`);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not rehydrate ${imageRef} from object storage: ${(error as Error).message}`,
      );
      return false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Captures the exact Gitea OCI image into the same durable object-store
   * representation used by GitHub Actions. Direct Docker and remote Agent
   * targets therefore share one immutable build identity and Agents never need
   * a registry password.
   */
  async captureRegistryArtifact(
    repository: ScmRepositoryRef,
    project: { id: string; workspaceId: string },
    operationId: string,
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
      await this.bindOperationArtifact(operationId, project.id, existing.id);
      return existing;
    }

    const dir = mkdtempSync(join(tmpdir(), 'initpad-registry-artifact-'));
    const filePath = join(dir, 'image.tar');
    const imageRef = registryImageRef(repository, normalizedVersion);
    const artifactId = existing?.id ?? randomUUID();
    let objectKey: string | null = null;
    let persisted = false;
    try {
      await this.deployment.saveImageArchive(imageRef, filePath);
      const [digest, metadata] = await Promise.all([this.fileSha256(filePath), stat(filePath)]);
      objectKey = artifactObjectKey({
        workspaceId: project.workspaceId,
        projectId: project.id,
        artifactId,
        digest,
      });
      await this.store.put(objectKey, filePath, {
        contentType: 'application/x-tar',
        sizeBytes: metadata.size,
      });
      const values = {
        projectId: project.id,
        sourceProvider: 'gitea-oci',
        providerArtifactId,
        providerRunId: '',
        commitSha: normalizedVersion,
        name: 'initpad-image.tar',
        digest,
        sizeBytes: BigInt(metadata.size),
        expiresAt: new Date(Date.now() + config.artifactStore.retentionDays * 86_400_000),
        status: 'available',
        storageKind: 'object-store',
        storageRef: objectKey,
        error: null,
      } as const;
      let artifact: BuildArtifact;
      if (existing) {
        artifact = await this.prisma.buildArtifact.update({
          where: { id: existing.id },
          data: values,
        });
      } else {
        try {
          artifact = await this.prisma.buildArtifact.create({
            data: { id: artifactId, ...values },
          });
        } catch (error) {
          const winner = await this.prisma.buildArtifact.findUnique({ where: unique });
          if (!winner || winner.projectId !== project.id || winner.status !== 'available') {
            throw error;
          }
          if (winner.storageRef !== objectKey) await this.store.delete(objectKey);
          artifact = winner;
        }
      }
      persisted = true;
      if (existing?.storageRef && existing.storageRef !== artifact.storageRef) {
        await this.store.delete(existing.storageRef).catch(() => undefined);
      }
      await this.bindOperationArtifact(operationId, project.id, artifact.id);
      this.logger.log(`Captured registry image ${imageRef} for verified delivery`);
      return artifact;
    } catch (error) {
      if (objectKey && !persisted) await this.store.delete(objectKey).catch(() => undefined);
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Deletes a project's durable artifact objects from the store. Returns the
  // object keys that could not be removed so deletion can surface or accept
  // cleanup debt. Store deletion is idempotent.
  async purgeProjectObjects(projectId: string): Promise<string[]> {
    const artifacts = await this.prisma.buildArtifact.findMany({
      where: { projectId, storageKind: 'object-store', storageRef: { not: null } },
      select: { storageRef: true },
    });
    const failures: string[] = [];
    for (const artifact of artifacts) {
      if (!artifact.storageRef) continue;
      try {
        await this.store.delete(artifact.storageRef);
      } catch (error) {
        failures.push(`${artifact.storageRef}: ${(error as Error).message}`);
      }
    }
    return failures;
  }

  // ADR-059 §7, ADR-075 and ADR-082: remove expired durable objects only
  // when no live environment, pending production request, unfinished operation
  // or bounded rollback point still refers to the immutable artifact.
  async runRetention(now: Date = new Date()): Promise<{ removed: number; kept: number }> {
    const cutoff = new Date(now.getTime() - config.artifactStore.retentionDays * 86_400_000);
    const stale = await this.prisma.buildArtifact.findMany({
      where: {
        storageKind: 'object-store',
        storageRef: { not: null },
        createdAt: { lt: cutoff },
      },
      select: { id: true, storageRef: true },
    });
    let removed = 0;
    let kept = 0;
    for (const artifact of stale) {
      if (!artifact.storageRef) continue;
      if (await this.isReferenced(artifact.id)) {
        kept += 1;
        continue;
      }
      try {
        await this.store.delete(artifact.storageRef);
      } catch (error) {
        this.logger.warn(
          `Retention: could not delete object ${artifact.storageRef}: ${(error as Error).message}`,
        );
        kept += 1;
        continue;
      }
      await this.prisma.buildArtifact.updateMany({
        where: { id: artifact.id },
        data: {
          status: 'failed',
          error: 'Expired by retention policy',
          storageKind: null,
          storageRef: null,
        },
      });
      removed += 1;
    }
    if (removed) this.logger.log(`Retention GC removed ${removed} expired artifact object(s)`);
    return { removed, kept };
  }

  // ADR-059 §8: a short-lived URL grants access only to one verified object.
  // The URL is returned to the deployment job or future Agent and never stored.
  async presignDownload(
    buildArtifactId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const artifact = await this.prisma.buildArtifact.findFirst({
      where: {
        id: buildArtifactId,
        status: 'available',
        storageKind: 'object-store',
        storageRef: { not: null },
      },
      select: { storageRef: true },
    });
    if (!artifact?.storageRef) {
      throw new NotFoundException('No downloadable build artifact exists for this id');
    }
    const expiresInSeconds = config.artifactStore.presignTtlSeconds;
    const url = await this.store.presignGet(artifact.storageRef, expiresInSeconds);
    return { url, expiresInSeconds };
  }

  private async isReferenced(buildArtifactId: string): Promise<boolean> {
    const environmentReferences = await this.prisma.environment.count({
      where: { buildArtifactId },
    });
    if (environmentReferences > 0) return true;
    const productionRequestReferences = await this.prisma.productionDeploymentRequest.count({
      where: { buildArtifactId, status: { in: ['pending', 'approving'] } },
    });
    if (productionRequestReferences > 0) return true;
    const unfinishedOperations = await this.prisma.deploymentOperation.count({
      where: { buildArtifactId, finishedAt: null },
    });
    if (unfinishedOperations > 0) return true;

    // Preserve only the newest successful publication artifact which differs
    // from each environment's current artifact. This makes manual rollback
    // dependable without turning operation history into unbounded blob
    // retention. An empty environment keeps its latest published artifact so
    // it can still be restored without another CI build.
    const publishedTo = await this.prisma.deploymentOperation.findMany({
      where: {
        buildArtifactId,
        status: 'succeeded',
        kind: { in: [...DEPLOYMENT_PUBLICATION_KINDS] },
      },
      select: { environmentId: true },
      distinct: ['environmentId'],
    });
    for (const publication of publishedTo) {
      const environment = await this.prisma.environment.findUnique({
        where: { id: publication.environmentId },
        select: { buildArtifactId: true },
      });
      if (!environment) continue;
      const newestRollbackPoint = await this.prisma.deploymentOperation.findFirst({
        where: {
          environmentId: publication.environmentId,
          status: 'succeeded',
          kind: { in: [...DEPLOYMENT_PUBLICATION_KINDS] },
          buildArtifactId: { not: null },
          ...(environment.buildArtifactId
            ? { NOT: { buildArtifactId: environment.buildArtifactId } }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { buildArtifactId: true },
      });
      if (newestRollbackPoint?.buildArtifactId === buildArtifactId) return true;
    }
    return false;
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
    if (bound.count !== 1) {
      throw new Error('Deployment operation is no longer active');
    }
  }
}
