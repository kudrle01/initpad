import { ConflictException } from '@nestjs/common';
import { Prisma, type AgentJob } from '@prisma/client';
import { generateToken, hashToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService, type AuthenticatedAgent } from './agents.service';

export const AGENT_JOB_LEASE_PREFIX = 'initpad_lease_';
export const AGENT_JOB_NEXT_POLL_SECONDS = 2;
const LEASE_MS = 30_000;
/**
 * A job whose lease expired this many times never reached a terminal state
 * (Agent crash, hang or restart loop). Re-leasing it again would block the
 * target's FIFO queue forever, so the next claim fails it instead.
 */
export const AGENT_JOB_MAX_ATTEMPTS = 3;
export const AGENT_JOB_ATTEMPTS_EXHAUSTED = 'attempts_exhausted';

export type AgentJobClaimAttempt =
  | { outcome: 'empty' }
  | { outcome: 'raced' }
  | { outcome: 'exhausted'; jobId: string }
  | {
      outcome: 'claimed';
      row: AgentJob;
      leaseToken: string;
      leaseExpiresAt: Date;
    };

/**
 * Security boundary for Agent job ownership. Every state mutation is fenced by
 * the immutable Agent identity, its current credential generation, target,
 * lease token and expiry. Projection and job-result handling live elsewhere.
 */
export class AgentJobLeases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
  ) {}

  authenticate(authorization: string | undefined): Promise<AuthenticatedAgent> {
    return this.agents.authenticateCredential(authorization);
  }

  async claimOnce(agent: AuthenticatedAgent, now = new Date()): Promise<AgentJobClaimAttempt> {
    const candidate = await this.prisma.agentJob.findFirst({
      where: {
        targetId: agent.targetId,
        protocolVersion: { lte: agent.protocolVersion },
        OR: [{ status: 'queued' }, { status: 'leased', leaseExpiresAt: { lte: now } }],
        ...this.activeCredential(agent),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, leaseTokenHash: true, attempt: true },
    });
    if (!candidate) return { outcome: 'empty' };

    if (candidate.status === 'leased' && candidate.attempt >= AGENT_JOB_MAX_ATTEMPTS) {
      const exhausted = await this.prisma.agentJob.updateMany({
        where: {
          id: candidate.id,
          targetId: agent.targetId,
          status: 'leased',
          leaseExpiresAt: { lte: now },
          leaseTokenHash: candidate.leaseTokenHash,
        },
        data: {
          status: 'failed',
          progressStage: 'failed',
          message:
            `Agent did not finish the job after ${candidate.attempt} attempts; ` +
            'each lease expired without a result. Check the Agent logs on the server, then retry.',
          resultCode: AGENT_JOB_ATTEMPTS_EXHAUSTED,
          result: Prisma.DbNull,
          leaseExpiresAt: null,
          finishedAt: now,
        },
      });
      return exhausted.count === 1
        ? { outcome: 'exhausted', jobId: candidate.id }
        : { outcome: 'raced' };
    }

    const leaseToken = `${AGENT_JOB_LEASE_PREFIX}${generateToken()}`;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.prisma.agentJob.updateMany({
      where: {
        id: candidate.id,
        targetId: agent.targetId,
        ...this.activeCredential(agent),
        ...(candidate.status === 'queued'
          ? { status: 'queued' }
          : {
              status: 'leased',
              leaseExpiresAt: { lte: now },
              leaseTokenHash: candidate.leaseTokenHash,
            }),
      },
      data: {
        status: 'leased',
        leasedByAgentId: agent.id,
        leaseTokenHash: hashToken(leaseToken),
        leasedAt: now,
        leaseExpiresAt,
        attempt: { increment: 1 },
        progressSequence: 0,
        progressPercent: 0,
        progressStage: 'assigned',
        message: 'Claimed by Agent',
        resultCode: null,
        result: Prisma.DbNull,
        finishedAt: null,
      },
    });
    if (claimed.count !== 1) return { outcome: 'raced' };

    return {
      outcome: 'claimed',
      row: await this.prisma.agentJob.findUniqueOrThrow({ where: { id: candidate.id } }),
      leaseToken,
      leaseExpiresAt,
    };
  }

  async renew(
    authorization: string | undefined,
    jobId: string,
    leaseToken: string,
    now = new Date(),
  ): Promise<{ leaseExpiresAt: string }> {
    const agent = await this.authenticate(authorization);
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const renewed = await this.prisma.agentJob.updateMany({
      where: this.activeLease(agent, jobId, leaseToken, now),
      data: { leaseExpiresAt },
    });
    if (renewed.count !== 1) throw this.lostLease();
    return { leaseExpiresAt: leaseExpiresAt.toISOString() };
  }

  boundLease(agent: AuthenticatedAgent, jobId: string, leaseToken: string) {
    return {
      id: jobId,
      targetId: agent.targetId,
      leasedByAgentId: agent.id,
      leaseTokenHash: hashToken(leaseToken),
      ...this.activeCredential(agent),
    };
  }

  activeLease(agent: AuthenticatedAgent, jobId: string, leaseToken: string, now: Date) {
    return {
      ...this.boundLease(agent, jobId, leaseToken),
      status: 'leased',
      leaseExpiresAt: { gt: now },
    };
  }

  hasTokenShape(leaseToken: string | undefined): leaseToken is string {
    return Boolean(leaseToken?.startsWith(AGENT_JOB_LEASE_PREFIX));
  }

  lostLease(): ConflictException {
    return new ConflictException('Agent job lease is no longer valid');
  }

  private activeCredential(agent: AuthenticatedAgent) {
    return {
      target: {
        agent: {
          is: {
            id: agent.id,
            disabledAt: null,
            OR: [
              { credentialHash: agent.credentialHash },
              { pendingCredentialHash: agent.credentialHash },
            ],
          },
        },
      },
    };
  }
}
