import { createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import * as tarStream from 'tar-stream';

import { ProjectArtifactIngestion } from './project-artifact-ingestion';
import { ProjectDeploymentOperations } from './project-deployment-operations';

const SHA = 'a'.repeat(40);
const RUN = 'run-1';
const EXPECTED_REF = `ghcr.io/acme/api:${SHA}-${RUN}`;

const repository = {
  provider: 'github',
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  repositoryId: '101',
  defaultBranch: 'main',
} as never;

const artifact = {
  provider: 'github-actions',
  providerArtifactId: '901',
  providerRunId: RUN,
  commitSha: SHA,
  name: 'initpad-image.tar',
  digest: 'd'.repeat(64),
  sizeBytes: 12,
  expiresAt: new Date('2026-08-01T00:00:00Z'),
} as never;

// A minimal, valid `docker save` archive tagged exactly EXPECTED_REF, so the
// daemon-free identity check inside ingest passes.
async function writeArchive(path: string): Promise<void> {
  const pack = tarStream.pack();
  const out = createWriteStream(path);
  pack.pipe(out);
  pack.entry(
    { name: 'manifest.json' },
    JSON.stringify([{ Config: 'config.json', RepoTags: [EXPECTED_REF], Layers: ['layer.tar'] }]),
  );
  pack.entry({ name: 'config.json' }, '{}');
  pack.entry({ name: 'layer.tar' }, Buffer.alloc(0));
  pack.finalize();
  await finished(out);
}

function makeIngestion(
  prisma: Record<string, unknown>,
  scm: Record<string, unknown>,
  deployment: Record<string, unknown>,
  store: Record<string, unknown>,
) {
  const operations = new ProjectDeploymentOperations(prisma as never);
  jest
    .spyOn(operations, 'runWithExecutionLease')
    .mockImplementation(async (_operationId, task) => task());
  jest.spyOn(operations, 'assertExecution').mockResolvedValue();
  jest.spyOn(operations, 'cancelled').mockResolvedValue(false);
  const deployVerifiedArtifact = jest.fn(async () => undefined);
  const ingestion = new ProjectArtifactIngestion(
    prisma as never,
    { provider: jest.fn(() => scm) } as never,
    deployment as never,
    store as never,
    operations,
    deployVerifiedArtifact,
  );
  return { ingestion, deployVerifiedArtifact, operations };
}

describe('ProjectArtifactIngestion → object storage', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'initpad-ingest-'));
    filePath = join(dir, 'initpad-image.tar');
    await writeArchive(filePath);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function basePrisma(updateMany: jest.Mock) {
    return {
      $queryRaw: jest.fn(async () => [{ id: 'a1', generation: 1 }]),
      buildArtifact: {
        updateMany,
        findUnique: jest.fn(async () => ({ id: 'a1', project: { workspaceId: 'ws1' } })),
      },
      environment: { updateMany: jest.fn(async () => ({ count: 1 })) },
      deploymentOperation: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => ({ correlationId: 'correlation-1' })),
      },
      project: { update: jest.fn(async () => ({})) },
    };
  }

  it('recovers only an expired artifact lease through a generation CAS', async () => {
    const expiredAt = new Date('2026-10-03T08:00:00.000Z');
    const artifactUpdate = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      buildArtifact: {
        updateMany: artifactUpdate,
        findMany: jest.fn(async () => [
          {
            id: 'a1',
            status: 'ingesting',
            projectId: 'project-1',
            commitSha: SHA,
            createdAt: new Date('2026-10-03T07:00:00.000Z'),
            ingestionOwner: 'dead-replica',
            ingestionGeneration: 4,
            ingestionLeaseExpiresAt: expiredAt,
            operations: [],
          },
        ]),
      },
    };
    const ingestion = new ProjectArtifactIngestion(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      jest.fn(),
    );

    await ingestion.recoverInterrupted();

    expect(artifactUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'a1',
        status: 'ingesting',
        ingestionOwner: 'dead-replica',
        ingestionGeneration: 4,
      }),
      data: expect.objectContaining({
        status: 'failed',
        ingestionOwner: null,
        ingestionLeaseExpiresAt: null,
      }),
    });
  });

  it('does not recover a live artifact lease owned by another API replica', async () => {
    const findMany = jest.fn(async () => []);
    const transaction = jest.fn();
    const ingestion = new ProjectArtifactIngestion(
      { buildArtifact: { findMany }, $transaction: transaction } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      jest.fn(),
    );

    await ingestion.recoverInterrupted();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: 'ingesting',
              OR: expect.arrayContaining([
                expect.objectContaining({ ingestionLeaseExpiresAt: { lte: expect.any(Date) } }),
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('leaves an expired artifact untouched while its deployment operation is still live', async () => {
    const artifactUpdate = jest.fn();
    const ingestion = new ProjectArtifactIngestion(
      {
        buildArtifact: {
          updateMany: artifactUpdate,
          findMany: jest.fn(async () => [
            {
              id: 'a1',
              status: 'ingesting',
              projectId: 'project-1',
              commitSha: SHA,
              createdAt: new Date('2026-10-03T07:00:00.000Z'),
              ingestionOwner: 'replica-1',
              ingestionGeneration: 2,
              ingestionLeaseExpiresAt: new Date('2026-10-03T08:00:00.000Z'),
              operations: [{ id: 'operation-1' }],
            },
          ]),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      jest.fn(),
    );

    await ingestion.recoverInterrupted();

    expect(artifactUpdate).not.toHaveBeenCalled();
  });

  it('uploads the verified bytes and marks the artifact available (object-store)', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = basePrisma(updateMany);
    const scm = {
      downloadBuildArtifact: jest.fn(async () => ({ filePath, cleanup: jest.fn() })),
    };
    const deployment = { loadImageArchive: jest.fn(async () => undefined) };
    const store = {
      put: jest.fn(async () => undefined),
      head: jest.fn(async () => ({ sizeBytes: 12 })),
      delete: jest.fn(async () => undefined),
    };
    const { ingestion, operations } = makeIngestion(prisma, scm, deployment, store);

    await ingestion.ingest('project-1', repository, artifact, 'op-1');

    const expectedKey = 'artifacts/ws1/project-1/a1/' + 'd'.repeat(64) + '.tar';
    expect(store.put).toHaveBeenCalledWith(expectedKey, filePath, expect.any(Object));
    expect(store.head).toHaveBeenCalledWith(expectedKey);
    expect(deployment.loadImageArchive).toHaveBeenCalledWith(filePath, EXPECTED_REF);
    expect(store.delete).not.toHaveBeenCalled();
    expect(operations.runWithExecutionLease).toHaveBeenCalledWith('op-1', expect.any(Function));
    // Final DB transition records object-store + the opaque key.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'available',
          storageKind: 'object-store',
          storageRef: expectedKey,
        }),
      }),
    );
  });

  it('stores a prod-only artifact without creating or running a deployment', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = basePrisma(updateMany);
    const scm = {
      downloadBuildArtifact: jest.fn(async () => ({ filePath, cleanup: jest.fn() })),
    };
    const deployment = { loadImageArchive: jest.fn(async () => undefined) };
    const store = {
      put: jest.fn(async () => undefined),
      head: jest.fn(async () => ({ sizeBytes: 12 })),
      delete: jest.fn(async () => undefined),
    };
    const { ingestion, deployVerifiedArtifact } = makeIngestion(prisma, scm, deployment, store);

    await ingestion.ingest('project-1', repository, artifact, null);

    expect(deployVerifiedArtifact).not.toHaveBeenCalled();
    expect(prisma.deploymentOperation.update).not.toHaveBeenCalled();
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { lastCommit: `ci: verified ${SHA.slice(0, 7)}` },
    });
  });

  it('deletes the partial object and fails when the upload cannot be confirmed', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = basePrisma(updateMany);
    const scm = {
      downloadBuildArtifact: jest.fn(async () => ({ filePath, cleanup: jest.fn() })),
    };
    const deployment = { loadImageArchive: jest.fn(async () => undefined) };
    const store = {
      put: jest.fn(async () => undefined),
      head: jest.fn(async () => null), // upload not confirmed
      delete: jest.fn(async () => undefined),
    };
    const { ingestion } = makeIngestion(prisma, scm, deployment, store);

    await ingestion.ingest('project-1', repository, artifact, 'op-1');

    const expectedKey = 'artifacts/ws1/project-1/a1/' + 'd'.repeat(64) + '.tar';
    expect(store.delete).toHaveBeenCalledWith(expectedKey);
    expect(deployment.loadImageArchive).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('renews a slow ingestion and publishes only through its generation fence', async () => {
    jest.useFakeTimers();
    let finishDownload!: () => void;
    const waitForDownload = new Promise<void>((resolve) => {
      finishDownload = resolve;
    });
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = basePrisma(updateMany);
    const query = prisma.$queryRaw as jest.Mock;
    const scm = {
      downloadBuildArtifact: jest.fn(async () => {
        await waitForDownload;
        return { filePath, cleanup: jest.fn() };
      }),
    };
    const store = {
      put: jest.fn(async () => undefined),
      head: jest.fn(async () => ({ sizeBytes: 12 })),
      delete: jest.fn(async () => undefined),
    };
    const { ingestion } = makeIngestion(
      prisma,
      scm,
      { loadImageArchive: jest.fn(async () => undefined) },
      store,
    );

    const running = ingestion.ingest('project-1', repository, artifact, null);
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(2);
    finishDownload();
    await running;

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'a1',
        status: 'ingesting',
        ingestionGeneration: 1,
      }),
      data: expect.objectContaining({
        status: 'available',
        ingestionOwner: null,
        ingestionLeaseExpiresAt: null,
      }),
    });
    jest.useRealTimers();
  });

  it('does not publish or clean shared storage after losing the ingestion lease', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = basePrisma(updateMany);
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([{ id: 'a1', generation: 3 }])
      .mockResolvedValueOnce([]);
    const store = {
      put: jest.fn(async () => undefined),
      head: jest.fn(async () => ({ sizeBytes: 12 })),
      delete: jest.fn(async () => undefined),
    };
    const { ingestion } = makeIngestion(
      prisma,
      {
        downloadBuildArtifact: jest.fn(async () => ({ filePath, cleanup: jest.fn() })),
      },
      { loadImageArchive: jest.fn(async () => undefined) },
      store,
    );

    await ingestion.ingest('project-1', repository, artifact, null);

    expect(store.put).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'available' }) }),
    );
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('does not reset an artifact identity already bound to another project', async () => {
    const prisma = {
      workspace: { findUnique: jest.fn(async () => ({ maxArtifactBytes: 1024n })) },
      buildArtifact: {
        findUnique: jest.fn(async () => ({
          id: 'artifact-existing',
          projectId: 'project-2',
          commitSha: SHA,
          status: 'available',
          sizeBytes: 12n,
        })),
        aggregate: jest.fn(async () => ({ _sum: { sizeBytes: 12n } })),
        create: jest.fn(),
        update: jest.fn(),
      },
      project: { findUnique: jest.fn(async () => ({ workspaceId: 'workspace-1' })) },
      environment: { updateMany: jest.fn(async () => ({ count: 1 })) },
      deploymentOperation: {
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ correlationId: 'correlation-1' })),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (run: (client: typeof prisma) => unknown) =>
      run(prisma),
    );
    const { ingestion, deployVerifiedArtifact } = makeIngestion(prisma, {}, {}, {});

    await expect(ingestion.queue('project-1', repository, artifact, 'op-1')).rejects.toThrow(
      'already bound to another deployment',
    );
    expect(prisma.buildArtifact.create).not.toHaveBeenCalled();
    expect(prisma.buildArtifact.update).not.toHaveBeenCalled();
    expect(deployVerifiedArtifact).not.toHaveBeenCalled();
  });
});
