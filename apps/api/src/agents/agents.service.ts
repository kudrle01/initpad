import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateToken, hashToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import { EnrollAgentDto } from './dto/enroll-agent.dto';
import { AuditEventsService } from '../audit/audit-events.service';

const ENROLLMENT_TTL_MS = 15 * 60_000;
export const ONLINE_AFTER_HEARTBEAT_MS = 90_000;
const ENROLLMENT_PREFIX = 'initpad_enroll_';
const CREDENTIAL_PREFIX = 'initpad_agent_';
const HEARTBEAT_INTERVAL_SECONDS = 30;
const AGENT_CREDENTIAL_PATTERN = /^Bearer (initpad_agent_[A-Za-z0-9_-]{43})$/;

interface AgentRow {
  id: string;
  targetId: string;
  enrollmentTokenHash: string | null;
  enrollmentExpiresAt: Date | null;
  credentialHash: string | null;
  credentialGeneration: number;
  protocolVersion: number;
  version: string | null;
  capabilities: unknown | null;
  enrolledAt: Date | null;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedAgent {
  id: string;
  targetId: string;
  credentialHash: string;
  credentialGeneration: number;
  protocolVersion: number;
}

export interface AgentSummary {
  id: string;
  targetId: string;
  state: 'not-enrolled' | 'offline' | 'online' | 'disabled';
  enrollmentPending: boolean;
  enrollmentExpiresAt: string | null;
  credentialGeneration: number;
  protocolVersion: number;
  version: string | null;
  capabilities: unknown | null;
  enrolledAt: string | null;
  lastSeenAt: string | null;
  disabledAt: string | null;
}

export function agentHeartbeatIsFresh(
  lastSeenAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  return !!lastSeenAt && now - lastSeenAt.getTime() <= ONLINE_AFTER_HEARTBEAT_MS;
}

/**
 * Owns the Agent trust bootstrap. Runtime job authentication deliberately
 * builds on the issued credential later; enrollment itself knows nothing about
 * deployments, allocations or Docker operations.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: async () => undefined,
    },
  ) {}

  async getForTarget(targetId: string, userId: string): Promise<AgentSummary | null> {
    await this.requireTargetAccess(targetId, userId, 'read');
    const agent = await this.prisma.agent.findUnique({ where: { targetId } });
    return agent ? this.summary(agent as AgentRow) : null;
  }

  async issueEnrollment(
    targetId: string,
    userId: string,
  ): Promise<AgentSummary & { enrollmentToken: string }> {
    const target = await this.requireTargetAccess(targetId, userId, 'admin');
    const now = new Date();
    const enrollmentToken = `${ENROLLMENT_PREFIX}${generateToken()}`;
    const enrollmentExpiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS);
    const agent = (await this.prisma.agent.upsert({
      where: { targetId },
      create: {
        targetId,
        enrollmentTokenHash: hashToken(enrollmentToken),
        enrollmentExpiresAt,
      },
      update: {
        enrollmentTokenHash: hashToken(enrollmentToken),
        enrollmentExpiresAt,
        // Issuing a new one-time enrollment is the explicit administrator
        // action that re-enables a previously disabled physical agent.
        disabledAt: null,
      },
    })) as AgentRow;
    await this.auditEvents.record({
      workspaceId: target.workspaceId,
      actorUserId: userId,
      action: 'agent.enrollment_issued',
      resourceType: 'agent',
      resourceId: agent.id,
      resourceName: target.name,
      details: {
        targetId,
        generation: agent.credentialGeneration,
        expiresInMinutes: ENROLLMENT_TTL_MS / 60_000,
      },
    });
    return { ...this.summary(agent), enrollmentToken };
  }

  async enroll(dto: EnrollAgentDto): Promise<{
    agentId: string;
    targetId: string;
    credential: string;
    credentialGeneration: number;
    protocolVersion: number;
  }> {
    const now = new Date();
    const enrollmentTokenHash = hashToken(dto.token);
    const agent = (await this.prisma.agent.findUnique({
      where: { enrollmentTokenHash },
    })) as AgentRow | null;
    if (
      !agent ||
      agent.disabledAt ||
      !agent.enrollmentExpiresAt ||
      agent.enrollmentExpiresAt.getTime() <= now.getTime()
    ) {
      throw new UnauthorizedException('Invalid or expired Agent enrollment token');
    }

    const credential = `${CREDENTIAL_PREFIX}${generateToken()}`;
    const credentialGeneration = agent.credentialGeneration + 1;
    // Compare-and-set makes the token strictly single-use even when two Agent
    // processes race to redeem the same copied command.
    const claimed = await this.prisma.agent.updateMany({
      where: {
        id: agent.id,
        enrollmentTokenHash,
        enrollmentExpiresAt: { gt: now },
        disabledAt: null,
      },
      data: {
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
        credentialHash: hashToken(credential),
        credentialGeneration,
        protocolVersion: dto.protocolVersion,
        version: dto.version,
        enrolledAt: now,
        lastSeenAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired Agent enrollment token');
    }
    return {
      agentId: agent.id,
      targetId: agent.targetId,
      credential,
      credentialGeneration,
      protocolVersion: dto.protocolVersion,
    };
  }

  async heartbeat(
    authorization: string | undefined,
    dto: AgentHeartbeatDto,
  ): Promise<{
    targetId: string;
    credentialGeneration: number;
    acceptedAt: string;
    nextHeartbeatSeconds: number;
  }> {
    const agent = await this.authenticateCredential(authorization);
    const credentialHash = agent.credentialHash;

    const now = new Date();
    // Compare-and-set closes the revoke race between credential lookup and the
    // heartbeat write. A revoked Agent never becomes online again because an
    // already in-flight request happened to finish late.
    const accepted = await this.prisma.agent.updateMany({
      where: {
        id: agent.id,
        credentialHash,
        disabledAt: null,
      },
      data: {
        version: dto.version,
        protocolVersion: dto.protocolVersion,
        capabilities: { ...dto.docker },
        lastSeenAt: now,
      },
    });
    if (accepted.count !== 1) {
      throw new UnauthorizedException('Invalid Agent credential');
    }
    return {
      targetId: agent.targetId,
      credentialGeneration: agent.credentialGeneration,
      acceptedAt: now.toISOString(),
      nextHeartbeatSeconds: HEARTBEAT_INTERVAL_SECONDS,
    };
  }

  async disable(targetId: string, userId: string): Promise<void> {
    const target = await this.requireTargetAccess(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({ where: { targetId } });
    if (!agent) throw new NotFoundException(`Agent for target '${targetId}' not found`);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.agent.update({
        where: { targetId },
        data: {
          disabledAt: now,
          enrollmentTokenHash: null,
          enrollmentExpiresAt: null,
          credentialHash: null,
        },
      }),
      this.prisma.workloadDiagnostic.updateMany({
        where: {
          status: { in: ['queued', 'running'] },
          currentJob: { is: { targetId } },
        },
        data: {
          status: 'failed',
          message: 'Agent disabled by a workspace administrator',
          finishedAt: now,
        },
      }),
      this.prisma.agentJob.updateMany({
        where: { targetId, status: { in: ['blocked', 'queued', 'leased'] } },
        data: {
          status: 'cancelled',
          progressStage: 'cancelled',
          message: 'Agent disabled by a workspace administrator',
          leaseExpiresAt: null,
          finishedAt: now,
        },
      }),
    ]);
    await this.auditEvents.record({
      workspaceId: target.workspaceId,
      actorUserId: userId,
      action: 'agent.disabled',
      resourceType: 'agent',
      resourceId: agent.id,
      resourceName: target.name,
      details: { targetId },
    });
  }

  async authenticateCredential(
    authorization: string | undefined,
  ): Promise<AuthenticatedAgent> {
    const credential = authorization?.match(AGENT_CREDENTIAL_PATTERN)?.[1];
    if (!credential) throw new UnauthorizedException('Invalid Agent credential');
    const credentialHash = hashToken(credential);
    const agent = (await this.prisma.agent.findUnique({
      where: { credentialHash },
    })) as AgentRow | null;
    if (!agent || agent.disabledAt || !agent.credentialHash) {
      throw new UnauthorizedException('Invalid Agent credential');
    }
    return {
      id: agent.id,
      targetId: agent.targetId,
      credentialHash,
      credentialGeneration: agent.credentialGeneration,
      protocolVersion: agent.protocolVersion,
    };
  }

  async requireTargetAccess(
    targetId: string,
    userId: string,
    permission: 'read' | 'admin',
  ): Promise<{ workspaceId: string; name: string }> {
    const target = await this.prisma.target.findUnique({
      where: { id: targetId },
      select: { kind: true, scope: true, workspaceId: true, name: true },
    });
    if (!target || target.scope === 'builtin' || !target.workspaceId) {
      throw new NotFoundException(`Target '${targetId}' not found`);
    }
    const role = await this.workspaces.roleFor(userId, target.workspaceId);
    if (!role) throw new NotFoundException(`Target '${targetId}' not found`);
    if (permission === 'admin' && !this.workspaces.can(role, 'admin')) {
      throw new ForbiddenException('Workspace admin access required to manage the Agent');
    }
    if (target.kind !== 'docker') {
      throw new BadRequestException('InitPad Agent can only be bound to a Docker target');
    }
    return { workspaceId: target.workspaceId, name: target.name };
  }

  private summary(agent: AgentRow): AgentSummary {
    const heartbeatFresh = agentHeartbeatIsFresh(agent.lastSeenAt);
    return {
      id: agent.id,
      targetId: agent.targetId,
      state: agent.disabledAt
        ? 'disabled'
        : agent.credentialHash
          ? heartbeatFresh
            ? 'online'
            : 'offline'
          : 'not-enrolled',
      enrollmentPending:
        !!agent.enrollmentTokenHash &&
        !!agent.enrollmentExpiresAt &&
        agent.enrollmentExpiresAt.getTime() > Date.now(),
      enrollmentExpiresAt: agent.enrollmentExpiresAt?.toISOString() ?? null,
      credentialGeneration: agent.credentialGeneration,
      protocolVersion: agent.protocolVersion,
      version: agent.version,
      capabilities: agent.capabilities,
      enrolledAt: agent.enrolledAt?.toISOString() ?? null,
      lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
      disabledAt: agent.disabledAt?.toISOString() ?? null,
    };
  }
}
