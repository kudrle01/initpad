import { ConflictException } from '@nestjs/common';
import { hashToken } from '../common/token';
import { AgentJobLeases } from './agent-job-leases';

const NOW = new Date('2026-08-12T09:00:00.000Z');
const AGENT = {
  id: 'agent-1',
  targetId: 'target-1',
  credentialHash: 'current-credential-hash',
  credentialGeneration: 2,
  protocolVersion: 1,
};

function leasedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    targetId: AGENT.targetId,
    allocationId: null,
    deploymentOperationId: null,
    kind: 'probe',
    protocolVersion: 1,
    payload: {},
    dedupeKey: 'probe:1',
    status: 'leased',
    attempt: 1,
    leasedByAgentId: AGENT.id,
    leaseTokenHash: 'lease-hash',
    leasedAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    progressSequence: 0,
    progressPercent: 0,
    progressStage: 'assigned',
    message: 'Claimed by Agent',
    resultCode: null,
    result: null,
    createdAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

describe('AgentJobLeases fencing', () => {
  it('claims through a target and current-credential CAS fence', async () => {
    const row = leasedJob();
    const prisma = {
      agentJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: row.id,
          status: 'queued',
          leaseTokenHash: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      },
    };
    const leases = new AgentJobLeases(prisma as never, {} as never);

    const result = await leases.claimOnce(AGENT, NOW);

    expect(result).toMatchObject({
      outcome: 'claimed',
      row,
      leaseToken: expect.stringMatching(/^initpad_lease_/),
      leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    });
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: row.id,
          targetId: AGENT.targetId,
          status: 'queued',
          target: {
            agent: {
              is: {
                id: AGENT.id,
                OR: [
                  { credentialHash: AGENT.credentialHash },
                  { pendingCredentialHash: AGENT.credentialHash },
                ],
                disabledAt: null,
              },
            },
          },
        }),
        data: expect.objectContaining({
          status: 'leased',
          leasedByAgentId: AGENT.id,
          attempt: { increment: 1 },
          leaseTokenHash: expect.any(String),
        }),
      }),
    );
  });

  it('does not publish a lease when the credential fence loses its CAS race', async () => {
    const prisma = {
      agentJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'job-1',
          status: 'queued',
          leaseTokenHash: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
    };
    const leases = new AgentJobLeases(prisma as never, {} as never);

    await expect(leases.claimOnce(AGENT, NOW)).resolves.toEqual({ outcome: 'raced' });
    expect(prisma.agentJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('renews only the unexpired lease owned by the authenticated Agent', async () => {
    const leaseToken = `initpad_lease_${'b'.repeat(43)}`;
    const prisma = {
      agentJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const agents = { authenticateCredential: jest.fn().mockResolvedValue(AGENT) };
    const leases = new AgentJobLeases(prisma as never, agents as never);

    await expect(
      leases.renew('Bearer credential', 'job-1', leaseToken, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'job-1',
        targetId: AGENT.targetId,
        leasedByAgentId: AGENT.id,
        leaseTokenHash: hashToken(leaseToken),
        leaseExpiresAt: { gt: NOW },
      }),
      data: { leaseExpiresAt: new Date(NOW.getTime() + 30_000) },
    });
  });
});
