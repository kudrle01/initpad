import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';
import { AddWorkspaceMemberDto, AssignableRole, UpdateWorkspaceMemberDto } from './dto/member.dto';
import { repositoryRef } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { AuditEventsService } from '../audit/audit-events.service';

const REPOSITORY_SELECT = {
  scmProvider: true,
  scmRepositoryId: true,
  scmOwner: true,
  scmRepositoryName: true,
  scmFullName: true,
  scmDefaultBranch: true,
  scmInstallationId: true,
  repoUrl: true,
} as const;

export type WorkspaceRole = 'owner' | 'admin' | 'maintainer' | 'member' | 'viewer';
export type WorkspacePermission = 'read' | 'write' | 'maintain' | 'admin';

const PERMISSIONS: Record<WorkspacePermission, ReadonlySet<WorkspaceRole>> = {
  read: new Set(['owner', 'admin', 'maintainer', 'member', 'viewer']),
  write: new Set(['owner', 'admin', 'maintainer', 'member']),
  maintain: new Set(['owner', 'admin', 'maintainer']),
  admin: new Set(['owner', 'admin']),
};

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: async () => undefined,
    },
  ) {}

  async list(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      slug: m.workspace.slug,
      name: m.workspace.name,
      type: m.workspace.type,
      role: m.role as WorkspaceRole,
      productionApprovalPolicy: m.workspace.productionApprovalPolicy,
      createdAt: m.workspace.createdAt.toISOString(),
    }));
  }

  async resolve(userId: string, requestedId?: string): Promise<{ id: string; role: WorkspaceRole }> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: requestedId
        ? { userId, workspaceId: requestedId }
        : { userId, workspace: { type: 'personal' } },
      orderBy: { createdAt: 'asc' },
    });
    const fallback = membership ?? (!requestedId
      ? await this.prisma.workspaceMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
      : null);
    if (!fallback) {
      throw new ForbiddenException(requestedId ? 'You are not a member of this workspace' : 'No workspace available');
    }
    return { id: fallback.workspaceId, role: fallback.role as WorkspaceRole };
  }

  // The user's role in a workspace, or null when they are not a member. Lets a
  // caller distinguish "not a member" (hide the resource with 404) from "member
  // but insufficient role" (403).
  async roleFor(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return (membership?.role as WorkspaceRole | undefined) ?? null;
  }

  // Whether a role satisfies a permission tier.
  can(role: WorkspaceRole, permission: WorkspacePermission): boolean {
    return PERMISSIONS[permission].has(role);
  }

  async require(
    userId: string,
    workspaceId: string,
    permission: WorkspacePermission,
  ): Promise<WorkspaceRole> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    const role = membership?.role as WorkspaceRole | undefined;
    if (!role || !PERMISSIONS[permission].has(role)) {
      throw new ForbiddenException(`Workspace ${permission} access required`);
    }
    return role;
  }

  async requireProject(
    userId: string,
    projectId: string,
    permission: WorkspacePermission,
  ): Promise<{ workspaceId: string; role: WorkspaceRole }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw new NotFoundException(`Project '${projectId}' not found`);
    const role = await this.roleFor(userId, project.workspaceId);
    // A project outside the caller's workspaces must be indistinguishable from
    // an unknown id. Members still receive 403 when their role is insufficient.
    if (!role) throw new NotFoundException(`Project '${projectId}' not found`);
    if (!this.can(role, permission)) {
      throw new ForbiddenException(`Workspace ${permission} access required`);
    }
    return { workspaceId: project.workspaceId, role };
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const duplicate = await this.prisma.workspace.findUnique({ where: { slug: dto.slug } });
    if (duplicate) throw new ConflictException(`Workspace slug '${dto.slug}' is already taken`);
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug,
        type: 'team',
        members: { create: { userId, role: 'owner' } },
      },
    });
    await this.auditEvents.record({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: workspace.id,
      resourceName: workspace.name,
      details: { type: workspace.type },
    });
    return { ...workspace, role: 'owner' as const, createdAt: workspace.createdAt.toISOString() };
  }

  async update(userId: string, workspaceId: string, dto: UpdateWorkspaceDto) {
    await this.require(userId, workspaceId, 'admin');
    const previous = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    if (!previous) throw new NotFoundException('Workspace not found');
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: dto.name.trim() },
    });
    const membership = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (previous.name !== workspace.name) {
      await this.auditEvents.record({
        workspaceId,
        actorUserId: userId,
        action: 'workspace.updated',
        resourceType: 'workspace',
        resourceId: workspace.id,
        resourceName: workspace.name,
        details: { previousName: previous.name, name: workspace.name },
      });
    }
    return { ...workspace, role: membership.role as WorkspaceRole, createdAt: workspace.createdAt.toISOString() };
  }

  async updateProductionApprovalPolicy(
    userId: string,
    workspaceId: string,
    policy: 'self-review' | 'separate-reviewer',
  ) {
    await this.require(userId, workspaceId, 'admin');
    const previous = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!previous) throw new NotFoundException('Workspace not found');
    if (previous.type === 'personal') {
      throw new BadRequestException('Personal workspaces always use self-review');
    }
    if (previous.productionApprovalPolicy === policy) {
      const membership = await this.prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      return {
        ...previous,
        role: membership.role as WorkspaceRole,
        createdAt: previous.createdAt.toISOString(),
      };
    }
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { productionApprovalPolicy: policy },
    });
    const membership = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.production_policy_changed',
      resourceType: 'workspace',
      resourceId: workspaceId,
      resourceName: workspace.name,
      details: {
        previousPolicy: previous.productionApprovalPolicy,
        policy,
      },
    });
    return {
      ...workspace,
      role: membership.role as WorkspaceRole,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  async remove(userId: string, workspaceId: string): Promise<void> {
    const role = await this.require(userId, workspaceId, 'admin');
    if (role !== 'owner') throw new ForbiddenException('Only the workspace owner can delete it');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { _count: { select: { projects: true, targets: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') throw new BadRequestException('Personal workspaces cannot be deleted');
    if (workspace._count.projects || workspace._count.targets) {
      throw new BadRequestException('Delete or move all projects and targets before deleting this workspace');
    }
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async members(userId: string, workspaceId: string) {
    await this.require(userId, workspaceId, 'read');
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role as WorkspaceRole,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async addMember(userId: string, workspaceId: string, dto: AddWorkspaceMemberDto) {
    await this.require(userId, workspaceId, 'admin');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { type: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') {
      throw new BadRequestException('Create a team workspace before adding other members');
    }
    const identity = dto.identity.trim();
    const member = await this.prisma.user.findFirst({
      where: { OR: [{ username: identity }, { email: identity.toLowerCase() }] },
    });
    if (!member) throw new NotFoundException(`User '${identity}' not found`);
    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
    });
    if (existing) throw new ConflictException('User is already a workspace member');
    await this.attachMember(workspaceId, member.id, dto.role);
    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.member_added',
      resourceType: 'member',
      resourceId: member.id,
      resourceName: member.username,
      details: { role: dto.role },
    });
    return this.members(userId, workspaceId);
  }

  /**
   * Creates a workspace membership and mirrors the role into the private Gitea
   * repositories, rolling the membership back if the SCM sync fails so the two
   * never diverge. Kept public within the service for bootstrap and migration
   * paths that need the same cross-system invariant as direct member creation.
   */
  async attachMember(
    workspaceId: string,
    memberUserId: string,
    role: AssignableRole,
  ): Promise<void> {
    await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: memberUserId, role },
    });
    try {
      await this.syncRepositoryAccess(workspaceId, memberUserId, role);
    } catch (error) {
      await this.revokeRepositoryAccess(workspaceId, memberUserId).catch(() => undefined);
      await this.prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: memberUserId } },
      });
      throw error;
    }
  }

  async updateMember(
    userId: string,
    workspaceId: string,
    memberId: string,
    dto: UpdateWorkspaceMemberDto,
  ) {
    await this.require(userId, workspaceId, 'admin');
    const member = await this.memberOrThrow(workspaceId, memberId);
    if (member.role === 'owner') throw new BadRequestException('Workspace owner role cannot be changed');
    try {
      await this.syncRepositoryAccess(workspaceId, memberId, dto.role);
    } catch (error) {
      await this.syncRepositoryAccess(workspaceId, memberId, member.role).catch(() => undefined);
      throw error;
    }
    try {
      await this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: memberId } },
        data: { role: dto.role },
      });
    } catch (error) {
      await this.syncRepositoryAccess(workspaceId, memberId, member.role).catch(() => undefined);
      throw error;
    }
    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.member_role_changed',
      resourceType: 'member',
      resourceId: memberId,
      resourceName: member.user.username,
      details: { previousRole: member.role, role: dto.role },
    });
    return this.members(userId, workspaceId);
  }

  async removeMember(userId: string, workspaceId: string, memberId: string): Promise<void> {
    await this.require(userId, workspaceId, 'admin');
    const member = await this.memberOrThrow(workspaceId, memberId);
    if (member.role === 'owner') throw new BadRequestException('Workspace owner cannot be removed');
    try {
      await this.revokeRepositoryAccess(workspaceId, memberId);
      await this.prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: memberId } },
      });
    } catch (error) {
      await this.syncRepositoryAccess(workspaceId, memberId, member.role).catch(() => undefined);
      throw error;
    }
    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.member_removed',
      resourceType: 'member',
      resourceId: memberId,
      resourceName: member.user.username,
      details: { previousRole: member.role },
    });
  }

  private async memberOrThrow(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { user: { select: { username: true } } },
    });
    if (!member) throw new NotFoundException('Workspace member not found');
    return member;
  }

  private async syncRepositoryAccess(workspaceId: string, memberUserId: string, role: string): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: REPOSITORY_SELECT,
    });
    for (const project of projects) {
      const repository = repositoryRef(project);
      const username = await this.workspaceScm.collaboratorUsername(
        memberUserId,
        repository.provider,
      );
      await this.workspaceScm.provider(repository.provider).setCollaborator(repository, username, role);
    }
  }

  private async revokeRepositoryAccess(workspaceId: string, memberUserId: string): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: REPOSITORY_SELECT,
    });
    for (const project of projects) {
      const repository = repositoryRef(project);
      const username = await this.workspaceScm.collaboratorUsername(
        memberUserId,
        repository.provider,
      );
      await this.workspaceScm.provider(repository.provider).removeCollaborator(repository, username);
    }
  }
}
