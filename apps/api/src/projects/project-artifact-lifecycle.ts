import { Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ArtifactStore } from '../artifacts/artifact-store';
import { config } from '../config';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmRepositoryRef } from '../scm/scm-provider';
import { artifactImageRef } from './project-deployment-identity';

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

  // ADR-059 §7: remove expired durable objects only when no live environment
  // or unfinished operation still refers to the immutable artifact.
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
    const unfinishedOperations = await this.prisma.deploymentOperation.count({
      where: { buildArtifactId, finishedAt: null },
    });
    return unfinishedOperations > 0;
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
}
