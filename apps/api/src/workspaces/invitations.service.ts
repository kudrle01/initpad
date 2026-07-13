import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService, WorkspaceRole } from './workspaces.service';
import { AuthService, SessionUser } from '../auth/auth.service';
import { generateToken, hashToken } from '../common/token';
import { CreateInvitationDto } from './dto/invitation.dto';
import { AssignableRole } from './dto/member.dto';
import { config } from '../config';

// What an owner/admin sees about an invitation. The token is never included.
export interface InvitationView {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  invitedBy: string;
  acceptedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

// Public preview shown on the acceptance page before signing in / registering.
export interface InvitationPreview {
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  expiresAt: string;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly auth: AuthService,
  ) {}

  async create(
    actingUserId: string,
    workspaceId: string,
    dto: CreateInvitationDto,
  ): Promise<{ invitation: InvitationView; token: string; acceptUrl: string }> {
    await this.workspaces.require(actingUserId, workspaceId, 'admin');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { type: true, name: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') {
      throw new BadRequestException('Create a team workspace before inviting members');
    }
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      });
      if (membership) throw new ConflictException('That person is already a member of this workspace');
    }
    const pending = await this.prisma.workspaceInvitation.findFirst({
      where: { workspaceId, email, status: 'pending' },
    });
    if (pending) {
      throw new ConflictException('There is already a pending invitation for this e-mail. Revoke it to reissue.');
    }

    const token = generateToken();
    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId,
        email,
        role: dto.role,
        tokenHash: hashToken(token),
        invitedById: actingUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      include: { invitedBy: true, acceptedBy: true },
    });
    return {
      invitation: this.toView(invitation),
      token,
      acceptUrl: `${config.auth.frontendUrl.replace(/\/+$/, '')}/invite/${token}`,
    };
  }

  async list(actingUserId: string, workspaceId: string): Promise<InvitationView[]> {
    await this.workspaces.require(actingUserId, workspaceId, 'admin');
    const rows = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: true, acceptedBy: true },
    });
    return rows.map((r) => this.toView(r));
  }

  async revoke(actingUserId: string, workspaceId: string, invitationId: string): Promise<void> {
    await this.workspaces.require(actingUserId, workspaceId, 'admin');
    const invitation = await this.prisma.workspaceInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }
    await this.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      data: { status: 'revoked', respondedAt: new Date() },
    });
  }

  /** Public preview for the acceptance page. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.validOrThrow(token);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: invitation.workspaceId },
      select: { name: true },
    });
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitation.invitedById },
      select: { username: true },
    });
    return {
      workspaceName: workspace?.name ?? 'a workspace',
      email: invitation.email,
      role: invitation.role as WorkspaceRole,
      invitedBy: inviter?.username ?? 'a workspace admin',
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** Accept as an already-signed-in user; the account e-mail must match. */
  async accept(userId: string, token: string): Promise<void> {
    const invitation = await this.validOrThrow(token);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if ((user.email ?? '').toLowerCase() !== invitation.email) {
      throw new ForbiddenException(
        `This invitation was sent to ${invitation.email}. Sign in with that account to accept it.`,
      );
    }
    await this.consume(invitation, user.id, user.username);
  }

  /** Register a brand-new account bound to the invited e-mail and accept it. */
  async registerAndAccept(
    token: string,
    username: string,
    password: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const invitation = await this.validOrThrow(token);
    const user = await this.auth.provisionManagedUser({
      username,
      email: invitation.email,
      password,
      platformRole: 'user',
      mustChangePassword: false,
    });
    await this.consume(invitation, user.id, user.username);
    return this.auth.createSession(user);
  }

  private async consume(
    invitation: { id: string; workspaceId: string; role: string },
    userId: string,
    username: string,
  ): Promise<void> {
    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
    });
    if (!existing) {
      await this.workspaces.attachMember(
        invitation.workspaceId,
        userId,
        username,
        invitation.role as AssignableRole,
      );
    }
    await this.prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', acceptedById: userId, respondedAt: new Date() },
    });
  }

  private async validOrThrow(token: string) {
    if (!token) throw new NotFoundException('Invitation not found');
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!invitation || invitation.status !== 'pending') {
      throw new NotFoundException('This invitation is not valid or has already been used');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      await this.prisma.workspaceInvitation
        .update({ where: { id: invitation.id }, data: { status: 'expired', respondedAt: new Date() } })
        .catch(() => undefined);
      throw new GoneException('This invitation has expired');
    }
    return invitation;
  }

  private toView(invitation: {
    id: string;
    email: string;
    role: string;
    status: string;
    invitedBy: { username: string };
    acceptedBy: { username: string } | null;
    expiresAt: Date;
    createdAt: Date;
  }): InvitationView {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as WorkspaceRole,
      status: invitation.status,
      invitedBy: invitation.invitedBy.username,
      acceptedBy: invitation.acceptedBy?.username ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }
}
