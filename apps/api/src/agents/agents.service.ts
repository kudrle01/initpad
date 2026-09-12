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
import { TargetsService } from '../targets/targets.service';
import {
  agentVersionAtLeast,
  MIN_CREDENTIAL_ROTATION_AGENT_VERSION,
} from './agent-version';

const ENROLLMENT_TTL_MS = 15 * 60_000;
export const ONLINE_AFTER_HEARTBEAT_MS = 90_000;
const ENROLLMENT_PREFIX = 'initpad_enroll_';
const CREDENTIAL_PREFIX = 'initpad_agent_';
const HEARTBEAT_INTERVAL_SECONDS = 30;
const CREDENTIAL_ROTATE_AFTER_MS = 30 * 24 * 60 * 60_000;
const PENDING_ROTATION_REISSUE_AFTER_MS = 24 * 60 * 60_000;
const AGENT_CREDENTIAL_PATTERN = /^Bearer (initpad_agent_[A-Za-z0-9_-]{43})$/;

interface AgentRow {
  id: string;
  targetId: string;
  enrollmentTokenHash: string | null;
  enrollmentExpiresAt: Date | null;
  credentialHash: string | null;
  credentialGeneration: number;
  credentialActivatedAt: Date | null;
  pendingCredentialHash: string | null;
  pendingCredentialGeneration: number | null;
  pendingCredentialIssuedAt: Date | null;
  protocolVersion: number;
  version: string | null;
  capabilities: unknown | null;
  enrolledAt: Date | null;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  target?: { workspaceId: string | null; name: string };
}

export interface AuthenticatedAgent {
  id: string;
  targetId: string;
  credentialHash: string;
  credentialGeneration: number;
  protocolVersion: number;
  credentialSlot?: 'active' | 'pending';
  credentialActivatedAt?: Date | null;
  enrolledAt?: Date | null;
  target?: { workspaceId: string | null; name: string };
}

export interface AgentSummary {
  id: string;
  targetId: string;
  state: 'not-enrolled' | 'offline' | 'online' | 'disabled';
  enrollmentPending: boolean;
  enrollmentExpiresAt: string | null;
  credentialGeneration: number;
  credentialActivatedAt: string | null;
  credentialRotationPending: boolean;
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
    private readonly targets: TargetsService,
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
    if (target.managementState === 'retired') {
      throw new BadRequestException('Restore this retired target before enrolling an Agent');
    }
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
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.agent.updateMany({
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
          credentialActivatedAt: now,
          pendingCredentialHash: null,
          pendingCredentialGeneration: null,
          pendingCredentialIssuedAt: null,
          protocolVersion: dto.protocolVersion,
          version: dto.version,
          enrolledAt: now,
          lastSeenAt: null,
        },
      });
      if (result.count !== 1) return result;
      const activated = await transaction.target.updateMany({
        where: { id: agent.targetId, managementState: { not: 'retired' } },
        data: { managementState: 'active', managementStateChangedAt: now },
      });
      if (activated.count !== 1) {
        throw new UnauthorizedException('Target is no longer available for Agent enrollment');
      }
      return result;
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
    credentialConfirmed: boolean;
    credentialRotation?: {
      credential: string;
      credentialGeneration: number;
    };
  }> {
    const agent = await this.authenticateCredential(authorization);
    const credentialHash = agent.credentialHash;

    const now = new Date();
    if (agent.credentialSlot === 'pending') {
      const accepted = await this.prisma.agent.updateMany({
        where: {
          id: agent.id,
          pendingCredentialHash: credentialHash,
          pendingCredentialGeneration: agent.credentialGeneration,
          disabledAt: null,
        },
        data: {
          credentialHash,
          credentialGeneration: agent.credentialGeneration,
          credentialActivatedAt: now,
          pendingCredentialHash: null,
          pendingCredentialGeneration: null,
          pendingCredentialIssuedAt: null,
          version: dto.version,
          protocolVersion: dto.protocolVersion,
          capabilities: { ...dto.docker },
          lastSeenAt: now,
        },
      });
      if (accepted.count !== 1) {
        throw new UnauthorizedException('Invalid Agent credential');
      }
      await this.recordAutomaticRotation(
        agent,
        'agent.credential_rotation_activated',
        agent.credentialGeneration,
      );
      return {
        targetId: agent.targetId,
        credentialGeneration: agent.credentialGeneration,
        credentialConfirmed: true,
        acceptedAt: now.toISOString(),
        nextHeartbeatSeconds: HEARTBEAT_INTERVAL_SECONDS,
      };
    }

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

    const response: {
      targetId: string;
      credentialGeneration: number;
      credentialConfirmed: boolean;
      acceptedAt: string;
      nextHeartbeatSeconds: number;
      credentialRotation?: { credential: string; credentialGeneration: number };
    } = {
      targetId: agent.targetId,
      credentialGeneration: agent.credentialGeneration,
      credentialConfirmed: true,
      acceptedAt: now.toISOString(),
      nextHeartbeatSeconds: HEARTBEAT_INTERVAL_SECONDS,
    };
    const activeSince = agent.credentialActivatedAt ?? agent.enrolledAt;
    if (
      activeSince
      && activeSince.getTime() <= now.getTime() - CREDENTIAL_ROTATE_AFTER_MS
      && agentVersionAtLeast(dto.version, MIN_CREDENTIAL_ROTATION_AGENT_VERSION)
    ) {
      const credential = `${CREDENTIAL_PREFIX}${generateToken()}`;
      const credentialGeneration = agent.credentialGeneration + 1;
      const stalePendingBefore = new Date(now.getTime() - PENDING_ROTATION_REISSUE_AFTER_MS);
      const issued = await this.prisma.agent.updateMany({
        where: {
          id: agent.id,
          credentialHash,
          credentialGeneration: agent.credentialGeneration,
          disabledAt: null,
          OR: [
            { pendingCredentialHash: null },
            { pendingCredentialIssuedAt: { lte: stalePendingBefore } },
          ],
        },
        data: {
          pendingCredentialHash: hashToken(credential),
          pendingCredentialGeneration: credentialGeneration,
          pendingCredentialIssuedAt: now,
        },
      });
      if (issued.count === 1) {
        response.credentialRotation = { credential, credentialGeneration };
        await this.recordAutomaticRotation(
          agent,
          'agent.credential_rotation_issued',
          credentialGeneration,
        );
      }
    }
    return response;
  }

  async disable(targetId: string, userId: string): Promise<void> {
    await this.requireTargetAccess(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({ where: { targetId }, select: { id: true } });
    if (!agent) throw new NotFoundException(`Agent for target '${targetId}' not found`);
    await this.targets.disconnect(targetId, userId);
  }

  async authenticateCredential(
    authorization: string | undefined,
  ): Promise<AuthenticatedAgent> {
    const credential = authorization?.match(AGENT_CREDENTIAL_PATTERN)?.[1];
    if (!credential) throw new UnauthorizedException('Invalid Agent credential');
    const credentialHash = hashToken(credential);
    const agent = (await this.prisma.agent.findFirst({
      where: {
        OR: [{ credentialHash }, { pendingCredentialHash: credentialHash }],
      },
      include: { target: { select: { workspaceId: true, name: true } } },
    })) as AgentRow | null;
    if (!agent || agent.disabledAt || (!agent.credentialHash && !agent.pendingCredentialHash)) {
      throw new UnauthorizedException('Invalid Agent credential');
    }
    const pending = agent.pendingCredentialHash === credentialHash;
    const credentialGeneration = pending
      ? agent.pendingCredentialGeneration
      : agent.credentialGeneration;
    if (!credentialGeneration) throw new UnauthorizedException('Invalid Agent credential');
    return {
      id: agent.id,
      targetId: agent.targetId,
      credentialHash,
      credentialGeneration,
      protocolVersion: agent.protocolVersion,
      credentialSlot: pending ? 'pending' : 'active',
      credentialActivatedAt: agent.credentialActivatedAt,
      enrolledAt: agent.enrolledAt,
      target: agent.target,
    };
  }

  async requireTargetAccess(
    targetId: string,
    userId: string,
    permission: 'read' | 'admin',
  ): Promise<{ workspaceId: string; name: string; managementState: string }> {
    const target = await this.prisma.target.findUnique({
      where: { id: targetId },
      select: { kind: true, scope: true, workspaceId: true, name: true, managementState: true },
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
    return {
      workspaceId: target.workspaceId,
      name: target.name,
      managementState: target.managementState,
    };
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
      credentialActivatedAt: agent.credentialActivatedAt?.toISOString() ?? null,
      credentialRotationPending: Boolean(agent.pendingCredentialHash),
      protocolVersion: agent.protocolVersion,
      version: agent.version,
      capabilities: agent.capabilities,
      enrolledAt: agent.enrolledAt?.toISOString() ?? null,
      lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
      disabledAt: agent.disabledAt?.toISOString() ?? null,
    };
  }

  private async recordAutomaticRotation(
    agent: AuthenticatedAgent,
    action: 'agent.credential_rotation_issued' | 'agent.credential_rotation_activated',
    generation: number,
  ): Promise<void> {
    if (!agent.target?.workspaceId) return;
    await this.auditEvents.record({
      workspaceId: agent.target.workspaceId,
      actorUserId: null,
      action,
      resourceType: 'agent',
      resourceId: agent.id,
      resourceName: agent.target.name,
      details: { generation },
    }).catch(() => undefined);
  }
}
