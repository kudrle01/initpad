import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateToken, hashToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { EnrollAgentDto } from './dto/enroll-agent.dto';

const ENROLLMENT_TTL_MS = 15 * 60_000;
const ONLINE_AFTER_HEARTBEAT_MS = 90_000;
const ENROLLMENT_PREFIX = 'initpad_enroll_';
const CREDENTIAL_PREFIX = 'initpad_agent_';

interface AgentRow {
  id: string;
  targetId: string;
  enrollmentTokenHash: string | null;
  enrollmentExpiresAt: Date | null;
  credentialHash: string | null;
  credentialGeneration: number;
  protocolVersion: number;
  version: string | null;
  enrolledAt: Date | null;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  enrolledAt: string | null;
  lastSeenAt: string | null;
  disabledAt: string | null;
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
  ) {}

  async getForTarget(targetId: string, userId: string): Promise<AgentSummary | null> {
    await this.authorizeTarget(targetId, userId, 'read');
    const agent = await this.prisma.agent.findUnique({ where: { targetId } });
    return agent ? this.summary(agent as AgentRow) : null;
  }

  async issueEnrollment(
    targetId: string,
    userId: string,
  ): Promise<AgentSummary & { enrollmentToken: string }> {
    await this.authorizeTarget(targetId, userId, 'admin');
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

  async disable(targetId: string, userId: string): Promise<void> {
    await this.authorizeTarget(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({ where: { targetId } });
    if (!agent) throw new NotFoundException(`Agent for target '${targetId}' not found`);
    await this.prisma.agent.update({
      where: { targetId },
      data: {
        disabledAt: new Date(),
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
        credentialHash: null,
      },
    });
  }

  private async authorizeTarget(
    targetId: string,
    userId: string,
    permission: 'read' | 'admin',
  ): Promise<void> {
    const target = await this.prisma.target.findUnique({
      where: { id: targetId },
      select: { kind: true, scope: true, workspaceId: true },
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
  }

  private summary(agent: AgentRow): AgentSummary {
    const heartbeatFresh =
      !!agent.lastSeenAt && Date.now() - agent.lastSeenAt.getTime() <= ONLINE_AFTER_HEARTBEAT_MS;
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
      enrolledAt: agent.enrolledAt?.toISOString() ?? null,
      lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
      disabledAt: agent.disabledAt?.toISOString() ?? null,
    };
  }
}
