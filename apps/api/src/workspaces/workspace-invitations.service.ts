import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';
import { generateToken, hashToken } from '../common/token';
import { normalizeAccountIdentifier } from '../common/account-identifier';
import { INVITATION_TTL_MS } from '../common/link-ttl';
import { AuditEventsService } from '../audit/audit-events.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import type { AssignableRole } from './dto/member.dto';
import { WorkspacesService, type WorkspaceRole } from './workspaces.service';

export { INVITATION_TTL_MS };
const INVALID_INVITATION = 'This invitation is invalid, expired or already used';

export interface InvitationView {
  id: string;
  email: string;
  role: AssignableRole;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInvitation {
  invitation: InvitationView;
  delivery: 'email' | 'manual';
  // Only without SMTP: the administrator passes the link on (ADR-188).
  inviteUrl?: string;
}

export interface InvitationPreview {
  workspaceName: string;
  role: AssignableRole;
  invitedBy: string | null;
  email: string;
  expiresAt: string;
}

/**
 * Consent-based entry to a team workspace (ADR-188). An owner or admin invites
 * an e-mail address; whoever holds the single-use link and is signed in
 * accepts it. The link token is stored only as a hash.
 */
@Injectable()
export class WorkspaceInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Optional() private readonly mail?: MailDeliveryService,
    @Optional()
    @Inject(AuditEventsService)
    private readonly audit: Pick<AuditEventsService, 'record'> = {
      record: () => Promise.resolve(),
    },
  ) {}

  async list(userId: string, workspaceId: string): Promise<InvitationView[]> {
    await this.workspaces.require(userId, workspaceId, 'admin');
    const rows = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId, ...pending() },
      include: { invitedBy: { select: { username: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(view);
  }

  async create(
    userId: string,
    workspaceId: string,
    input: { email: string; role: AssignableRole },
  ): Promise<CreatedInvitation> {
    await this.workspaces.require(userId, workspaceId, 'admin');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, type: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') {
      throw new BadRequestException('Create a team workspace before inviting other members');
    }
    const email = normalizeAccountIdentifier(input.email);
    const inviter = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, name: true },
    });
    const deliverByEmail = this.mail?.isEnabled() ?? false;
    const token = generateToken();
    const url = `${config.auth.frontendUrl.replace(/\/+$/, '')}/invite#${token}`;
    const invitation = await this.prisma.$transaction(async (tx) => {
      // One live invitation per address: a new one replaces the previous link.
      await tx.workspaceInvitation.updateMany({
        where: { workspaceId, email, ...pending() },
        data: { revokedAt: new Date() },
      });
      const created = await tx.workspaceInvitation.create({
        data: {
          workspaceId,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedById: userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        include: { invitedBy: { select: { username: true, name: true } } },
      });
      if (deliverByEmail) {
        await this.mail!.enqueueAuthMail(tx, {
          userId: null,
          kind: 'workspace_invite',
          recipient: email,
          displayName: null,
          url,
          workspaceName: workspace.name,
          inviterName: inviter?.name || inviter?.username,
          role: input.role,
        });
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'workspace.invitation_created',
          resourceType: 'invitation',
          resourceId: created.id,
          resourceName: email,
          details: { role: input.role, delivery: deliverByEmail ? 'email' : 'manual' },
        },
        tx,
      );
      return created;
    });
    if (deliverByEmail) {
      this.mail!.scheduleDelivery();
      return { invitation: view(invitation), delivery: 'email' };
    }
    return { invitation: view(invitation), delivery: 'manual', inviteUrl: url };
  }

  async revoke(userId: string, workspaceId: string, invitationId: string): Promise<void> {
    await this.workspaces.require(userId, workspaceId, 'admin');
    const revoked = await this.prisma.workspaceInvitation.updateMany({
      where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new NotFoundException('Invitation not found');
    const row = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
      select: { email: true },
    });
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.invitation_revoked',
      resourceType: 'invitation',
      resourceId: invitationId,
      resourceName: row?.email ?? null,
    });
  }

  /** What the invitation page shows before the user decides. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.usable(token);
    return {
      workspaceName: invitation.workspace.name,
      role: invitation.role as AssignableRole,
      invitedBy: invitation.invitedBy?.name || invitation.invitedBy?.username || null,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Accepts for the signed-in user. The claim is a conditional update, so two
   * concurrent requests cannot both use one link; a failed membership write
   * releases the claim again so the link is not lost.
   */
  async accept(
    userId: string,
    token: string,
  ): Promise<{ workspaceId: string; workspaceName: string; role: WorkspaceRole }> {
    const invitation = await this.usable(token);
    const existing = await this.workspaces.roleFor(userId, invitation.workspaceId);
    const claimed = await this.prisma.workspaceInvitation.updateMany({
      where: { id: invitation.id, ...pending() },
      data: { acceptedAt: new Date(), acceptedById: userId },
    });
    if (claimed.count !== 1) throw new BadRequestException(INVALID_INVITATION);
    if (!existing) {
      try {
        await this.workspaces.attachMember(
          invitation.workspaceId,
          userId,
          invitation.role as AssignableRole,
        );
      } catch (error) {
        await this.prisma.workspaceInvitation.updateMany({
          where: { id: invitation.id, acceptedById: userId },
          data: { acceptedAt: null, acceptedById: null },
        });
        throw error;
      }
    }
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    await this.audit.record({
      workspaceId: invitation.workspaceId,
      actorUserId: userId,
      action: 'workspace.invitation_accepted',
      resourceType: 'invitation',
      resourceId: invitation.id,
      resourceName: invitation.email,
      details: {
        role: invitation.role,
        account: account?.username ?? 'unknown',
        alreadyMember: existing != null,
      },
    });
    return {
      workspaceId: invitation.workspaceId,
      workspaceName: invitation.workspace.name,
      role: existing ?? (invitation.role as WorkspaceRole),
    };
  }

  private async usable(token: string) {
    if (!token) throw new BadRequestException(INVALID_INVITATION);
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        workspace: { select: { name: true, type: true } },
        invitedBy: { select: { username: true, name: true } },
      },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(INVALID_INVITATION);
    }
    if (invitation.workspace.type !== 'team') throw new ForbiddenException(INVALID_INVITATION);
    return invitation;
  }
}

function pending() {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
}

function view(row: {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
  invitedBy?: { username: string; name: string | null } | null;
}): InvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role as AssignableRole,
    invitedBy: row.invitedBy?.name || row.invitedBy?.username || null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
