import { ConflictException } from '@nestjs/common';
import { ProjectRollback } from './project-rollback';

const CURRENT = 'a'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const NOW = new Date('2026-08-31T10:00:00.000Z');

function artifact(id: string, status = 'available') {
  return {
    id,
    sourceProvider: 'github-actions',
    providerRunId: '77',
    digest: 'd'.repeat(64),
    status,
    storageKind: status === 'available' ? 'object-store' : null,
    storageRef: status === 'available' ? `artifacts/${id}.tar` : null,
  };
}

function environment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'environment-1',
    targetId: 'target-1',
    version: CURRENT,
    buildArtifactId: 'artifact-current',
    status: 'running',
    deploymentRequired: false,
    activeOperationId: null,
    provider: 'docker',
    target: { id: 'target-1', name: 'Team Docker', scope: 'user' },
    buildArtifact: artifact('artifact-current'),
    configVars: [{ key: 'APP_MODE', updatedAt: NOW }],
    project: { scmProvider: 'github' },
    ...overrides,
  };
}

function publication(
  id: string,
  version: string,
  buildArtifact: ReturnType<typeof artifact> | null,
) {
  return {
    id,
    version,
    buildArtifactId: buildArtifact?.id ?? null,
    buildArtifact,
    createdAt: NOW,
    finishedAt: NOW,
  };
}

describe('ProjectRollback', () => {
  it('selects the latest previous verified artifact and describes its impact', async () => {
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment()) },
      deploymentOperation: {
        findMany: jest.fn(async () => [
          publication('current-operation', CURRENT, artifact('artifact-current')),
          publication('previous-operation', PREVIOUS, artifact('artifact-previous')),
        ]),
      },
    };
    const rollback = new ProjectRollback(prisma as never, jest.fn());

    await expect(rollback.preview('project-1', 'dev')).resolves.toEqual({
      candidateOperationId: 'previous-operation',
      environment: 'dev',
      target: 'Team Docker',
      currentVersion: CURRENT,
      rollbackVersion: PREVIOUS,
      currentArtifact: {
        id: 'artifact-current',
        provider: 'github-actions',
        digest: 'd'.repeat(64),
        runId: '77',
      },
      rollbackArtifact: {
        id: 'artifact-previous',
        provider: 'github-actions',
        digest: 'd'.repeat(64),
        runId: '77',
      },
      sourceDeployedAt: NOW.toISOString(),
      stateToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(prisma.deploymentOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { buildArtifactId: 'artifact-current' },
        }),
      }),
    );
  });

  it('does not offer a durable rollback after its object-store artifact expired', async () => {
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment()) },
      deploymentOperation: {
        findMany: jest.fn(async () => [
          publication('previous-operation', PREVIOUS, artifact('artifact-previous', 'failed')),
        ]),
      },
    };
    const rollback = new ProjectRollback(prisma as never, jest.fn());

    await expect(rollback.preview('project-1', 'dev')).resolves.toBeNull();
  });

  it('supports a previous immutable Gitea OCI tag on a direct provider', async () => {
    const prisma = {
      environment: {
        findUnique: jest.fn(async () =>
          environment({
            provider: 'sftp',
            target: { id: 'target-1', name: 'ESO', scope: 'user' },
            project: { scmProvider: 'gitea' },
            buildArtifactId: null,
            buildArtifact: null,
          }),
        ),
      },
      deploymentOperation: {
        findMany: jest.fn(async () => [publication('previous-operation', PREVIOUS, null)]),
      },
    };
    const rollback = new ProjectRollback(prisma as never, jest.fn());

    await expect(rollback.preview('project-1', 'prod')).resolves.toMatchObject({
      candidateOperationId: 'previous-operation',
      target: 'ESO',
      rollbackVersion: PREVIOUS,
      rollbackArtifact: null,
    });
  });

  it('executes exactly the reviewed candidate and rejects stale confirmation state', async () => {
    const prisma = {
      environment: { findUnique: jest.fn(async () => environment()) },
      deploymentOperation: {
        findMany: jest.fn(async () => [
          publication('previous-operation', PREVIOUS, artifact('artifact-previous')),
        ]),
      },
    };
    const schedule = jest.fn(async () => undefined);
    const rollback = new ProjectRollback(prisma as never, schedule);
    const preview = await rollback.preview('project-1', 'test');

    await rollback.execute('project-1', 'test', 'previous-operation', preview!.stateToken);
    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'test',
      PREVIOUS,
      'artifact-previous',
      undefined,
    );

    await expect(
      rollback.execute('project-1', 'test', 'previous-operation', '0'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
