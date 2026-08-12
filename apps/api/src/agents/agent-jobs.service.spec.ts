import { BadRequestException, ConflictException } from '@nestjs/common';
import { Readable } from 'stream';
import { encryptSecret } from '../common/secret';
import { hashToken } from '../common/token';
import { AgentJobsService } from './agent-jobs.service';

const NOW = new Date('2026-08-12T09:00:00.000Z');
const AGENT = {
  id: 'agent-1',
  targetId: 'target-1',
  credentialHash: hashToken(`initpad_agent_${'a'.repeat(43)}`),
  credentialGeneration: 1,
  protocolVersion: 1,
};
const LEASE = `initpad_lease_${'b'.repeat(43)}`;

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    targetId: 'target-1',
    kind: 'probe',
    protocolVersion: 1,
    payload: { durationSeconds: 35 },
    status: 'leased',
    attempt: 1,
    leaseTokenHash: hashToken(LEASE),
    leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    progressSequence: 1,
    progressPercent: 10,
    progressStage: 'working',
    message: 'Probe running',
    resultCode: null,
    createdAt: NOW,
    leasedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    agent: {
      findUnique: jest.fn(async (): Promise<{
        credentialHash: string;
        disabledAt: Date | null;
        version: string;
        target: {
          kind: string;
          scope: string;
          workspaceId: string;
          capabilities: string;
          publicUrl: string;
          workspace: { slug: string };
        };
      } | null> => ({
        credentialHash: 'hash',
        disabledAt: null,
        version: '0.3.0',
        target: {
          kind: 'docker',
          scope: 'user',
          workspaceId: 'workspace-1',
          capabilities: 'node,php,static',
          publicUrl: 'https://apps.example.test',
          workspace: { slug: 'team-alpha' },
        },
      })),
    },
    targetAllocation: {
      upsert: jest.fn(async () => ({ id: 'allocation-1', namespace: 'team-alpha' })),
    },
    agentJob: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) =>
        job({ ...create, status: 'queued', attempt: 0, leasedAt: null, leaseExpiresAt: null }),
      ),
      findMany: jest.fn(async () => [job()]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(async () => job()),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const agents = {
    requireTargetAccess: jest.fn(async () => undefined),
    authenticateCredential: jest.fn(async () => AGENT),
  };
  const artifactStore = {
    head: jest.fn(async () => ({ sizeBytes: 13 })),
    openRead: jest.fn(async () => Readable.from('archive-bytes')),
  };
  return {
    service: new AgentJobsService(prisma as never, agents as never, artifactStore as never),
    prisma,
    agents,
    artifactStore,
  };
}

function deliveryBinding(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'deploy',
    targetId: 'target-1',
    allocationId: 'allocation-1',
    deploymentOperation: {
      buildArtifact: {
        digest: 'a'.repeat(64),
        sizeBytes: 13n,
        status: 'available',
        storageKind: 'object-store',
        storageRef: 'artifacts/ws/project/artifact/a.tar',
      },
      environment: {
        targetId: 'target-1',
        allocationId: 'allocation-1',
        configVars: [
          { key: 'APP_MODE', value: 'production', isSecret: false },
          { key: 'DATABASE_PASSWORD', value: encryptSecret('db-secret'), isSecret: true },
        ],
      },
    },
    ...overrides,
  };
}

describe('AgentJobsService durable lease protocol', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates an idempotent, bounded probe job for an enrolled target', async () => {
    const { service, prisma, agents } = setup();
    const dto = { requestId: '123e4567-e89b-42d3-a456-426614174000', durationSeconds: 35 };

    await expect(service.createProbe('target-1', 'owner-1', dto)).resolves.toMatchObject({
      kind: 'probe',
      status: 'queued',
    });
    expect(agents.requireTargetAccess).toHaveBeenCalledWith('target-1', 'owner-1', 'admin');
    expect(prisma.agentJob.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: `probe:target-1:${dto.requestId}` },
      update: {},
      create: expect.objectContaining({
        targetId: 'target-1',
        payload: { durationSeconds: 35 },
      }),
    });
  });

  it('does not queue a probe before enrollment', async () => {
    const { service, prisma } = setup();
    prisma.agent.findUnique.mockResolvedValue(null);
    await expect(service.createProbe('target-1', 'owner-1', {
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      durationSeconds: 35,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentJob.upsert).not.toHaveBeenCalled();
  });

  it('queues an allocation-scoped lifecycle test without executable input or secrets', async () => {
    const { service, prisma, agents } = setup();
    const requestId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(service.createLifecycleTest('target-1', 'owner-1', { requestId }))
      .resolves.toMatchObject({ kind: 'lifecycle-test', status: 'queued' });

    expect(agents.requireTargetAccess).toHaveBeenCalledWith('target-1', 'owner-1', 'admin');
    expect(prisma.targetAllocation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_targetId: { workspaceId: 'workspace-1', targetId: 'target-1' } },
      create: expect.objectContaining({ namespace: 'team-alpha', capabilities: 'node,php,static' }),
    }));
    const create = prisma.agentJob.upsert.mock.calls.at(-1)?.[0].create as {
      allocationId: string;
      payload: Record<string, unknown>;
    };
    expect(create.allocationId).toBe('allocation-1');
    expect(create.payload).toEqual(expect.objectContaining({
      allocationId: 'allocation-1',
      namespace: 'team-alpha',
      imageRef: expect.stringMatching(/^nginx@sha256:[a-f0-9]{64}$/),
    }));
    expect(create.payload).not.toHaveProperty('command');
    expect(create.payload).not.toHaveProperty('secret');
  });

  it('does not queue lifecycle work for an outdated Agent', async () => {
    const { service, prisma } = setup();
    const enrolled = await prisma.agent.findUnique();
    prisma.agent.findUnique.mockResolvedValue({ ...enrolled!, version: '0.2.0' });

    await expect(service.createLifecycleTest('target-1', 'owner-1', {
      requestId: '123e4567-e89b-42d3-a456-426614174000',
    })).rejects.toThrow(/0\.3\.0 or newer/);
    expect(prisma.targetAllocation.upsert).not.toHaveBeenCalled();
  });

  it('atomically claims only a compatible job on the authenticated target', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findFirst.mockResolvedValue({
      id: 'job-1', status: 'queued', leaseTokenHash: null,
    });
    prisma.agentJob.findUniqueOrThrow.mockImplementation(async () => job());

    const result = await service.claim('Bearer credential');

    expect(result.job).toEqual(expect.objectContaining({
      id: 'job-1',
      targetId: 'target-1',
      leaseToken: expect.stringMatching(/^initpad_lease_/),
    }));
    expect(prisma.agentJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        targetId: 'target-1',
        protocolVersion: { lte: 1 },
      }),
    }));
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', status: 'queued' }),
      data: expect.objectContaining({
        status: 'leased',
        attempt: { increment: 1 },
        leaseTokenHash: expect.any(String),
      }),
    }));
  });

  it('reclaims an expired lease with a new fencing token and attempt', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findFirst.mockResolvedValue({
      id: 'job-1', status: 'leased', leaseTokenHash: 'expired-hash',
    });

    await service.claim('Bearer credential');

    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'job-1',
        status: 'leased',
        leaseTokenHash: 'expired-hash',
        leaseExpiresAt: { lte: NOW },
      }),
      data: expect.objectContaining({ attempt: { increment: 1 } }),
    }));
  });

  it('materializes artifact metadata and decrypted config only for the winning deploy lease', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst
      .mockResolvedValueOnce({ id: 'job-1', status: 'queued', leaseTokenHash: null })
      .mockResolvedValueOnce(deliveryBinding());
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(job({
      kind: 'deploy',
      allocationId: 'allocation-1',
      deploymentOperationId: 'operation-1',
      payload: {
        allocationId: 'allocation-1',
        projectSlug: 'sample-project',
        environment: 'dev',
      },
    }));

    const result = await service.claim('Bearer credential');

    expect(result.job).toMatchObject({
      kind: 'deploy',
      payload: {
        allocationId: 'allocation-1',
        projectSlug: 'sample-project',
        environment: 'dev',
      },
      delivery: {
        artifact: {
          path: '/api/agent/jobs/job-1/artifact',
          sha256: 'a'.repeat(64),
          sizeBytes: 13,
        },
        envVars: {
          APP_MODE: 'production',
          DATABASE_PASSWORD: 'db-secret',
        },
      },
    });
    expect((result.job?.payload as Record<string, unknown>)).not.toHaveProperty('envVars');
    expect(JSON.stringify(prisma.agentJob.updateMany.mock.calls)).not.toContain('db-secret');
    expect(artifactStore.head).toHaveBeenCalledWith('artifacts/ws/project/artifact/a.tar');
  });

  it('streams a verified artifact only under the current target lease', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst.mockResolvedValue(deliveryBinding());

    const download = await service.openArtifact('Bearer credential', 'job-1', LEASE);

    expect(download).toMatchObject({ sha256: 'a'.repeat(64), sizeBytes: 13 });
    expect(artifactStore.openRead).toHaveBeenCalledWith('artifacts/ws/project/artifact/a.tar');
    expect(await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      download.stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      download.stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      download.stream.on('error', reject);
    })).toBe('archive-bytes');
  });

  it('does not expose an artifact after the lease is lost', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst.mockResolvedValue(null);

    await expect(service.openArtifact('Bearer credential', 'job-1', LEASE))
      .rejects.toBeInstanceOf(ConflictException);
    expect(artifactStore.openRead).not.toHaveBeenCalled();
  });

  it('renews and advances progress only under the current unexpired lease', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(job({
      progressSequence: 2, progressPercent: 40,
    }));

    await expect(service.renew('Bearer credential', 'job-1', LEASE)).resolves.toEqual({
      leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    });
    await expect(service.progress('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      sequence: 2,
      percent: 40,
      stage: 'working',
      message: 'Still running',
    })).resolves.toMatchObject({ progressSequence: 2, progressPercent: 40 });
    expect(prisma.agentJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        leaseTokenHash: hashToken(LEASE),
        leaseExpiresAt: { gt: NOW },
        progressSequence: { lt: 2 },
      }),
    }));
  });

  it('rejects a stale fencing token after the lease has been reassigned', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.agentJob.findUnique.mockResolvedValue(job({
      leaseTokenHash: hashToken(`initpad_lease_${'c'.repeat(43)}`),
      attempt: 2,
    }));

    await expect(service.progress('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      sequence: 2,
      percent: 40,
      stage: 'working',
      message: 'Stale worker',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('makes an identical completion retry idempotent after a lost response', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.agentJob.findUnique.mockResolvedValue(job({
      status: 'succeeded',
      leaseExpiresAt: null,
      progressPercent: 100,
      progressStage: 'succeeded',
      message: 'Probe completed',
      resultCode: 'ok',
      finishedAt: NOW,
    }));

    await expect(service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Probe completed',
      resultCode: 'ok',
    })).resolves.toMatchObject({ status: 'succeeded', resultCode: 'ok' });
  });
});
