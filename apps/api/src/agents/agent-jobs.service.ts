import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService, type AuthenticatedAgent } from './agents.service';
import {
  AgentJobCompleteDto,
  AgentJobProgressDto,
  CreateAgentProbeJobDto,
} from './dto/agent-job.dto';

const LEASE_MS = 30_000;
const NEXT_POLL_SECONDS = 2;
const LEASE_PREFIX = 'initpad_lease_';

interface JobRow {
  id: string;
  targetId: string;
  kind: string;
  protocolVersion: number;
  payload: unknown;
  status: string;
  attempt: number;
  leaseTokenHash: string | null;
  leaseExpiresAt: Date | null;
  progressSequence: number;
  progressPercent: number;
  progressStage: string;
  message: string | null;
  resultCode: string | null;
  createdAt: Date;
  leasedAt: Date | null;
  finishedAt: Date | null;
}

export interface AgentJobSummary {
  id: string;
  kind: string;
  status: string;
  attempt: number;
  progressSequence: number;
  progressPercent: number;
  progressStage: string;
  message: string | null;
  resultCode: string | null;
  createdAt: string;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
  finishedAt: string | null;
}

@Injectable()
export class AgentJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
  ) {}

  async createProbe(
    targetId: string,
    userId: string,
    dto: CreateAgentProbeJobDto,
  ): Promise<AgentJobSummary> {
    await this.agents.requireTargetAccess(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({
      where: { targetId },
      select: { credentialHash: true, disabledAt: true },
    });
    if (!agent?.credentialHash || agent.disabledAt) {
      throw new BadRequestException('Enroll and connect the Agent before testing its job protocol');
    }
    const row = await this.prisma.agentJob.upsert({
      where: { dedupeKey: `probe:${targetId}:${dto.requestId}` },
      update: {},
      create: {
        targetId,
        dedupeKey: `probe:${targetId}:${dto.requestId}`,
        kind: 'probe',
        protocolVersion: 1,
        payload: { durationSeconds: dto.durationSeconds },
        status: 'queued',
        progressStage: 'queued',
        message: 'Waiting for Agent',
      },
    });
    return this.summary(row as JobRow);
  }

  async list(targetId: string, userId: string): Promise<AgentJobSummary[]> {
    await this.agents.requireTargetAccess(targetId, userId, 'read');
    const rows = await this.prisma.agentJob.findMany({
      where: { targetId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return rows.map((row) => this.summary(row as JobRow));
  }

  async claim(authorization: string | undefined): Promise<{
    job: null | {
      id: string;
      targetId: string;
      kind: string;
      protocolVersion: number;
      payload: unknown;
      attempt: number;
      leaseToken: string;
      leaseExpiresAt: string;
    };
    nextPollSeconds: number;
  }> {
    const agent = await this.agents.authenticateCredential(authorization);
    for (let raceAttempt = 0; raceAttempt < 3; raceAttempt += 1) {
      const now = new Date();
      const candidate = await this.prisma.agentJob.findFirst({
        where: {
          targetId: agent.targetId,
          protocolVersion: { lte: agent.protocolVersion },
          OR: [
            { status: 'queued' },
            { status: 'leased', leaseExpiresAt: { lte: now } },
          ],
          ...this.activeAgentFilter(agent),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, leaseTokenHash: true },
      });
      if (!candidate) return { job: null, nextPollSeconds: NEXT_POLL_SECONDS };

      const leaseToken = `${LEASE_PREFIX}${generateToken()}`;
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      const claimed = await this.prisma.agentJob.updateMany({
        where: {
          id: candidate.id,
          targetId: agent.targetId,
          ...this.activeAgentFilter(agent),
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
          finishedAt: null,
        },
      });
      if (claimed.count !== 1) continue;
      const row = await this.prisma.agentJob.findUniqueOrThrow({ where: { id: candidate.id } });
      return {
        job: {
          id: row.id,
          targetId: row.targetId,
          kind: row.kind,
          protocolVersion: row.protocolVersion,
          payload: row.payload,
          attempt: row.attempt,
          leaseToken,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        },
        nextPollSeconds: NEXT_POLL_SECONDS,
      };
    }
    return { job: null, nextPollSeconds: 1 };
  }

  async renew(
    authorization: string | undefined,
    jobId: string,
    leaseToken: string,
  ): Promise<{ leaseExpiresAt: string }> {
    const agent = await this.agents.authenticateCredential(authorization);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const renewed = await this.prisma.agentJob.updateMany({
      where: this.activeLeaseWhere(agent, jobId, leaseToken, now),
      data: { leaseExpiresAt },
    });
    if (renewed.count !== 1) throw this.lostLease();
    return { leaseExpiresAt: leaseExpiresAt.toISOString() };
  }

  async progress(
    authorization: string | undefined,
    jobId: string,
    dto: AgentJobProgressDto,
  ): Promise<AgentJobSummary> {
    const agent = await this.agents.authenticateCredential(authorization);
    const now = new Date();
    const leaseTokenHash = hashToken(dto.leaseToken);
    const advanced = await this.prisma.agentJob.updateMany({
      where: {
        ...this.activeLeaseWhere(agent, jobId, dto.leaseToken, now),
        progressSequence: { lt: dto.sequence },
      },
      data: {
        progressSequence: dto.sequence,
        progressPercent: dto.percent,
        progressStage: dto.stage,
        message: dto.message,
      },
    });
    if (advanced.count !== 1) {
      const current = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
      if (
        !current ||
        current.targetId !== agent.targetId ||
        current.status !== 'leased' ||
        current.leaseTokenHash !== leaseTokenHash ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt <= now
      ) {
        throw this.lostLease();
      }
      return this.summary(current as JobRow);
    }
    return this.summary(await this.prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } }) as JobRow);
  }

  async complete(
    authorization: string | undefined,
    jobId: string,
    dto: AgentJobCompleteDto,
  ): Promise<AgentJobSummary> {
    const agent = await this.agents.authenticateCredential(authorization);
    const now = new Date();
    const leaseTokenHash = hashToken(dto.leaseToken);
    const completed = await this.prisma.agentJob.updateMany({
      where: this.activeLeaseWhere(agent, jobId, dto.leaseToken, now),
      data: {
        status: dto.status,
        progressPercent: dto.status === 'succeeded' ? 100 : undefined,
        progressStage: dto.status,
        message: dto.message,
        resultCode: dto.resultCode ?? null,
        leaseExpiresAt: null,
        finishedAt: now,
      },
    });
    if (completed.count !== 1) {
      const current = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
      if (
        !current ||
        current.targetId !== agent.targetId ||
        current.leaseTokenHash !== leaseTokenHash ||
        current.status !== dto.status ||
        current.message !== dto.message ||
        current.resultCode !== (dto.resultCode ?? null)
      ) {
        throw this.lostLease();
      }
      return this.summary(current as JobRow);
    }
    return this.summary(await this.prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } }) as JobRow);
  }

  private activeAgentFilter(agent: AuthenticatedAgent) {
    return {
      target: {
        agent: {
          is: {
            id: agent.id,
            credentialHash: agent.credentialHash,
            disabledAt: null,
          },
        },
      },
    };
  }

  private activeLeaseWhere(
    agent: AuthenticatedAgent,
    jobId: string,
    leaseToken: string,
    now: Date,
  ) {
    return {
      id: jobId,
      targetId: agent.targetId,
      status: 'leased',
      leasedByAgentId: agent.id,
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt: { gt: now },
      ...this.activeAgentFilter(agent),
    };
  }

  private lostLease(): ConflictException {
    return new ConflictException('Agent job lease is no longer valid');
  }

  private summary(row: JobRow): AgentJobSummary {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      attempt: row.attempt,
      progressSequence: row.progressSequence,
      progressPercent: row.progressPercent,
      progressStage: row.progressStage,
      message: row.message,
      resultCode: row.resultCode,
      createdAt: row.createdAt.toISOString(),
      leasedAt: row.leasedAt?.toISOString() ?? null,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
