import { BadRequestException, ConflictException } from '@nestjs/common';
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
      } | null> => ({ credentialHash: 'hash', disabledAt: null })),
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
  return {
    service: new AgentJobsService(prisma as never, agents as never),
    prisma,
    agents,
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
