import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BuildArtifact } from '@prisma/client';
import { createHash } from 'crypto';
import { createReadStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ArtifactStore } from '../artifacts/artifact-store';
import { config } from '../config';
import { DeploymentService } from '../deployment/deployment.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScmRepositoryRef } from '../scm/scm-provider';
import { DEPLOYMENT_PUBLICATION_KINDS } from './deployment-publications';
import { storedArtifactImageRef } from './project-deployment-identity';
import { ProjectRegistryArtifactCapture } from './project-registry-artifact-capture';

const RETENTION_BATCH_SIZE = 100;
const RETENTION_MAX_BATCHES = 20;

/**
 * Durable artifact lifecycle owned by the project domain. CI ingestion stays
 * outside this boundary; availability, retention, download grants and
 * project-object cleanup live here together.
 */
export class ProjectArtifactLifecycle {
  private readonly logger = new Logger('ProjectArtifactLifecycle');
  private readonly registryCapture: ProjectRegistryArtifactCapture;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ArtifactStore,
    private readonly deployment: DeploymentService,
  ) {
    this.registryCapture = new ProjectRegistryArtifactCapture(prisma, store, deployment);
  }

  /**
   * True when the verified archive is durably stored. An Agent deployment
   * needs nothing more, because the Agent downloads the archive itself.
   */
  async isArtifactStored(projectId: string, buildArtifactId: string): Promise<boolean> {
    const artifact = await this.prisma.buildArtifact.findFirst({
      where: {
        id: buildArtifactId,
        projectId,
        status: 'available',
        storageKind: 'object-store',
        storageRef: { not: null },
      },
      select: { id: true },
    });
    return artifact !== null;
  }

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
    const imageRef = storedArtifactImageRef(repository, artifact);
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
    operationId: string | null,
    version: string,
  ): Promise<BuildArtifact> {
    return this.registryCapture.capture(repository, project, operationId, version);
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
  // or bounded rollback point still refers to the immutable artifact. Expired
  // artifacts are read in bounded batches and every reference check covers a
  // whole batch, so one pass costs a fixed number of queries per batch.
  async runRetention(now: Date = new Date()): Promise<{ removed: number; kept: number }> {
    const cutoff = new Date(now.getTime() - config.artifactStore.retentionDays * 86_400_000);
    let removed = 0;
    let kept = 0;
    let cursor: string | undefined;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
      const stale = await this.prisma.buildArtifact.findMany({
        where: {
          storageKind: 'object-store',
          storageRef: { not: null },
          createdAt: { lt: cutoff },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: RETENTION_BATCH_SIZE,
        select: { id: true, storageRef: true },
      });
      if (stale.length === 0) break;
      cursor = stale[stale.length - 1].id;
      const referenced = await this.referencedArtifacts(stale.map((artifact) => artifact.id));
      for (const artifact of stale) {
        if (!artifact.storageRef) continue;
        if (referenced.has(artifact.id)) {
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
      if (stale.length < RETENTION_BATCH_SIZE) break;
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

  private async referencedArtifacts(ids: string[]): Promise<Set<string>> {
    const inBatch = { buildArtifactId: { in: ids } };
    const environments = await this.prisma.environment.findMany({
      where: inBatch,
      select: { buildArtifactId: true },
    });
    const requests = await this.prisma.productionDeploymentRequest.findMany({
      where: { ...inBatch, status: { in: ['pending', 'approving'] } },
      select: { buildArtifactId: true },
    });
    const unfinished = await this.prisma.deploymentOperation.findMany({
      where: { ...inBatch, finishedAt: null },
      select: { buildArtifactId: true },
    });
    const referenced = new Set<string>();
    for (const row of [...environments, ...requests, ...unfinished]) {
      if (row.buildArtifactId) referenced.add(row.buildArtifactId);
    }

    // Preserve only the newest successful publication artifact which differs
    // from each environment's current artifact. This makes manual rollback
    // dependable without turning operation history into unbounded blob
    // retention. An empty environment keeps its latest published artifact so
    // it can still be restored without another CI build.
    const publishedTo = await this.prisma.deploymentOperation.findMany({
      where: {
        ...inBatch,
        status: 'succeeded',
        kind: { in: [...DEPLOYMENT_PUBLICATION_KINDS] },
      },
      select: { environmentId: true },
      distinct: ['environmentId'],
    });
    if (publishedTo.length === 0) return referenced;
    const rollbackPoints = await this.prisma.$queryRaw<Array<{ buildArtifactId: string }>>(
      Prisma.sql`
        SELECT DISTINCT ON (o."environmentId") o."buildArtifactId"
        FROM "DeploymentOperation" o
        JOIN "Environment" e ON e."id" = o."environmentId"
        WHERE o."environmentId" IN (${Prisma.join(publishedTo.map((row) => row.environmentId))})
          AND o."status" = 'succeeded'
          AND o."kind" IN (${Prisma.join([...DEPLOYMENT_PUBLICATION_KINDS])})
          AND o."buildArtifactId" IS NOT NULL
          AND (e."buildArtifactId" IS NULL OR o."buildArtifactId" <> e."buildArtifactId")
        ORDER BY o."environmentId", o."createdAt" DESC
      `,
    );
    for (const point of rollbackPoints) referenced.add(point.buildArtifactId);
    return referenced;
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
