import { ConflictException } from '@nestjs/common';
import { AgentUpdatesService } from './agent-updates.service';

const target = {
  id: 'target-1',
  name: 'Application server',
  workspaceId: 'workspace-1',
  managementState: 'active',
};

function catalog(version: string | null) {
  const result = {
    enabled: true,
    checkedAt: '2026-09-16T10:00:00.000Z',
    stale: false,
    release: version
      ? {
          manifest: {
            version,
            image: { immutableReference: `ghcr.io/initpad/agent@sha256:${'a'.repeat(64)}` },
          },
          manifestBase64: Buffer.from('{"signed":true}').toString('base64'),
          bundle: { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json' },
          releaseUrl: `https://github.com/initpad/releases/${version}`,
          publishedAt: '2026-09-16T09:00:00.000Z',
        }
      : null,
    error: null,
  };
  return { latestAgentRelease: jest.fn(async () => result) };
}

function agents(version: string | null) {
  return {
    requireTargetAccess: jest.fn(async () => target),
    getForTarget: jest.fn(async () => ({ version })),
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b75f9fbd-8794-4f2b-a3d5-5507b2e63d01',
    correlationId: 'c9e371c7-1ab2-420f-a35c-28bc5adce672',
    kind: 'agent-update',
    status: 'queued',
    attempt: 0,
    progressSequence: 0,
    progressPercent: 0,
    progressStage: 'queued',
    message: 'Waiting to update Agent to 0.14.0',
    resultCode: null,
    createdAt: new Date('2026-09-16T10:00:00.000Z'),
    leasedAt: null,
    leaseExpiresAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function harness(version: string, latest: string) {
  const releaseCatalog = catalog(latest);
  const tx = {
    agentJob: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async (): Promise<{ id: string; kind: string } | null> => null),
      create: jest.fn(async () => job()),
    },
  };
  const prisma = {
    agentJob: {
      findUnique: jest.fn(async (): Promise<ReturnType<typeof job> | null> => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    service: new AgentUpdatesService(
      agents(version) as never,
      releaseCatalog as never,
      prisma as never,
      audit as never,
    ),
    releaseCatalog,
    prisma,
    tx,
    audit,
  };
}

describe('AgentUpdatesService', () => {
  it('marks the 0.12 to 0.13 bootstrap as a manual update', async () => {
    await expect(
      harness('0.12.1', '0.13.0').service.status('target-1', 'owner-1'),
    ).resolves.toMatchObject({
      currentVersion: '0.12.1',
      latestVersion: '0.13.0',
      updateAvailable: true,
      updateMethod: 'manual',
    });
  });

  it('allows remote updates only from an Agent with the update protocol', async () => {
    await expect(
      harness('0.13.0', '0.14.0').service.status('target-1', 'owner-1'),
    ).resolves.toMatchObject({
      updateAvailable: true,
      updateMethod: 'remote',
    });
  });

  it('does not downgrade a newer Agent', async () => {
    await expect(
      harness('0.14.0', '0.13.0').service.status('target-1', 'owner-1'),
    ).resolves.toMatchObject({
      updateAvailable: false,
      updateMethod: 'none',
    });
  });

  it('queues only the server-selected signed release and records the accepted operation', async () => {
    const { service, tx, audit } = harness('0.13.0', '0.14.0');

    await expect(
      service.requestUpdate('target-1', 'owner-1', {
        requestId: '99cf504c-1760-48bb-9fe1-c62606f93ea3',
      }),
    ).resolves.toMatchObject({ kind: 'agent-update', status: 'queued' });

    expect(tx.agentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: 'target-1',
        kind: 'agent-update',
        payload: expect.objectContaining({
          version: '0.14.0',
          manifestBase64: Buffer.from('{"signed":true}').toString('base64'),
        }),
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.update_requested',
        outcome: 'accepted',
        operation: { type: 'agent-job', id: job().id },
      }),
    );
  });

  it('rejects an update while another Agent job owns the target', async () => {
    const { service, tx } = harness('0.13.0', '0.14.0');
    tx.agentJob.findFirst.mockResolvedValueOnce({ id: 'job-2', kind: 'deploy' });

    await expect(
      service.requestUpdate('target-1', 'owner-1', {
        requestId: '99cf504c-1760-48bb-9fe1-c62606f93ea3',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns an idempotent retry without rechecking the catalog or duplicating audit', async () => {
    const { service, prisma, releaseCatalog, audit } = harness('0.14.0', '0.14.0');
    prisma.agentJob.findUnique.mockResolvedValueOnce(job({ status: 'succeeded' }));

    await expect(
      service.requestUpdate('target-1', 'owner-1', {
        requestId: '99cf504c-1760-48bb-9fe1-c62606f93ea3',
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });

    expect(releaseCatalog.latestAgentRelease).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('cancels a queued update if its audit record cannot be persisted', async () => {
    const { service, prisma, audit } = harness('0.13.0', '0.14.0');
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(
      service.requestUpdate('target-1', 'owner-1', {
        requestId: '99cf504c-1760-48bb-9fe1-c62606f93ea3',
      }),
    ).rejects.toThrow('audit unavailable');
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith({
      where: { id: job().id, status: 'queued' },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
  });
});
