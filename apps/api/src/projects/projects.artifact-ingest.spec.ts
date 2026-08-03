import { createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import * as tarStream from 'tar-stream';

import { ProjectsService } from './projects.service';

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

function makeService(
  prisma: Record<string, unknown>,
  scm: Record<string, unknown>,
  deployment: Record<string, unknown>,
  store: Record<string, unknown>,
) {
  const service = new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    deployment as never,
    {} as never,
    { provider: jest.fn(() => scm) } as never,
    {} as never,
    {} as never,
    store as never,
  );
  // Isolate the ingest unit from the deploy tail.
  const operations = (
    service as never as {
      operations: { cancelled: (operationId: string) => Promise<boolean> };
    }
  ).operations;
  jest.spyOn(operations, 'cancelled').mockResolvedValue(false);
  jest
    .spyOn(service as never as { deployEnvInBackground: () => Promise<void> }, 'deployEnvInBackground')
    .mockResolvedValue(undefined as never);
  return service;
}

describe('ProjectsService artifact ingest → object storage', () => {
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
      buildArtifact: {
        updateMany,
        findUnique: jest.fn(async () => ({ id: 'a1', project: { workspaceId: 'ws1' } })),
      },
      environment: { updateMany: jest.fn(async () => ({ count: 1 })) },
      deploymentOperation: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
    };
  }

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
    const service = makeService(prisma, scm, deployment, store);

    await (service as never as {
      ingestArtifactAndDeploy: (p: string, r: unknown, a: unknown, o: string) => Promise<void>;
    }).ingestArtifactAndDeploy('project-1', repository, artifact, 'op-1');

    const expectedKey = 'artifacts/ws1/project-1/a1/' + 'd'.repeat(64) + '.tar';
    expect(store.put).toHaveBeenCalledWith(expectedKey, filePath, expect.any(Object));
    expect(store.head).toHaveBeenCalledWith(expectedKey);
    expect(deployment.loadImageArchive).toHaveBeenCalledWith(filePath, EXPECTED_REF);
    expect(store.delete).not.toHaveBeenCalled();
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
    const service = makeService(prisma, scm, deployment, store);

    await (service as never as {
      ingestArtifactAndDeploy: (p: string, r: unknown, a: unknown, o: string) => Promise<void>;
    }).ingestArtifactAndDeploy('project-1', repository, artifact, 'op-1');

    const expectedKey = 'artifacts/ws1/project-1/a1/' + 'd'.repeat(64) + '.tar';
    expect(store.delete).toHaveBeenCalledWith(expectedKey);
    expect(deployment.loadImageArchive).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });
});
