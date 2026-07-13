import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';
import { AddWorkspaceMemberDto, UpdateWorkspaceMemberDto } from './dto/member.dto';
import { GiteaService } from '../scm/gitea.service';

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
    private readonly gitea: GiteaService,
  ) {}

  async list(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { include: { course: true, courseTeam: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      slug: m.workspace.slug,
      name: m.workspace.name,
      type: m.workspace.type,
      managedBy: m.workspace.course ? 'course' : m.workspace.courseTeam ? 'course-team' : null,
      role: m.role as WorkspaceRole,
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
    const role = await this.require(userId, project.workspaceId, permission);
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
    return {
      ...workspace,
      role: 'owner' as const,
      managedBy: null,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  async update(userId: string, workspaceId: string, dto: UpdateWorkspaceDto) {
    await this.require(userId, workspaceId, 'admin');
    await this.assertDirectMembershipEditable(workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: dto.name.trim() },
    });
    const membership = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return {
      ...workspace,
      role: membership.role as WorkspaceRole,
      managedBy: null,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  async remove(userId: string, workspaceId: string): Promise<void> {
    const role = await this.require(userId, workspaceId, 'admin');
    if (role !== 'owner') throw new ForbiddenException('Only the workspace owner can delete it');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        course: true,
        courseTeam: true,
        _count: { select: { projects: true, targets: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') throw new BadRequestException('Personal workspaces cannot be deleted');
    if (workspace.course || workspace.courseTeam) {
      throw new BadRequestException('Course-managed workspaces must be managed from the course');
    }
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
      select: { type: true, course: { select: { id: true } }, courseTeam: { select: { id: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') {
      throw new BadRequestException('Create a team workspace before adding other members');
    }
    if (workspace.course || workspace.courseTeam) {
      throw new BadRequestException('Course-managed membership must be changed from the course');
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
    await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.id, role: dto.role },
    });
    try {
      await this.syncRepositoryAccess(workspaceId, member.username, dto.role);
    } catch (error) {
      await this.revokeRepositoryAccess(workspaceId, member.username).catch(() => undefined);
      await this.prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: member.id } },
      });
      throw error;
    }
    return this.members(userId, workspaceId);
  }

  async updateMember(
    userId: string,
    workspaceId: string,
    memberId: string,
    dto: UpdateWorkspaceMemberDto,
  ) {
    await this.require(userId, workspaceId, 'admin');
    await this.assertDirectMembershipEditable(workspaceId);
    const member = await this.memberOrThrow(workspaceId, memberId);
    if (member.role === 'owner') throw new BadRequestException('Workspace owner role cannot be changed');
    const username = (await this.prisma.user.findUniqueOrThrow({ where: { id: memberId } })).username;
    try {
      await this.syncRepositoryAccess(workspaceId, username, dto.role);
    } catch (error) {
      await this.syncRepositoryAccess(workspaceId, username, member.role).catch(() => undefined);
      throw error;
    }
    try {
      await this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: memberId } },
        data: { role: dto.role },
      });
    } catch (error) {
      await this.syncRepositoryAccess(workspaceId, username, member.role).catch(() => undefined);
      throw error;
    }
    return this.members(userId, workspaceId);
  }

  async removeMember(userId: string, workspaceId: string, memberId: string): Promise<void> {
    await this.require(userId, workspaceId, 'admin');
    await this.assertDirectMembershipEditable(workspaceId);
    await this.revokeManagedMember(workspaceId, memberId);
  }

  /**
   * Internal membership reconciliation for a trusted domain service (courses).
   * The caller must authorize the domain action first. Keeping repository sync
   * here prevents course membership from becoming a second, drifting ACL.
   */
  async grantManagedMember(
    workspaceId: string,
    memberId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { type: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.type === 'personal') {
      throw new BadRequestException('Managed members cannot be added to a personal workspace');
    }
    const user = await this.prisma.user.findUnique({ where: { id: memberId } });
    if (!user) throw new NotFoundException('User not found');
    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: memberId } },
    });
    if (existing?.role === 'owner' || existing?.role === role) return;

    try {
      await this.syncRepositoryAccess(workspaceId, user.username, role);
      if (existing) {
        await this.prisma.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: memberId } },
          data: { role },
        });
      } else {
        await this.prisma.workspaceMember.create({
          data: { workspaceId, userId: memberId, role },
        });
      }
    } catch (error) {
      if (existing) {
        await this.syncRepositoryAccess(workspaceId, user.username, existing.role).catch(() => undefined);
      } else {
        await this.revokeRepositoryAccess(workspaceId, user.username).catch(() => undefined);
      }
      throw error;
    }
  }

  /** See grantManagedMember. Workspace owners are intentionally immutable. */
  async revokeManagedMember(workspaceId: string, memberId: string): Promise<void> {
    const member = await this.memberOrThrow(workspaceId, memberId);
    if (member.role === 'owner') throw new BadRequestException('Workspace owner cannot be removed');
    const username = (await this.prisma.user.findUniqueOrThrow({ where: { id: memberId } })).username;
    try {
      await this.revokeRepositoryAccess(workspaceId, username);
      await this.prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: memberId } },
      });
    } catch (error) {
      await this.syncRepositoryAccess(workspaceId, username, member.role).catch(() => undefined);
      throw error;
    }
  }

  private async memberOrThrow(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) throw new NotFoundException('Workspace member not found');
    return member;
  }

  private async assertDirectMembershipEditable(workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { course: { select: { id: true } }, courseTeam: { select: { id: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.course || workspace.courseTeam) {
      throw new BadRequestException('Course-managed membership must be changed from the course');
    }
  }

  private async syncRepositoryAccess(workspaceId: string, username: string, role: string): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { repoUrl: true },
    });
    for (const project of projects) await this.gitea.setCollaborator(project.repoUrl, username, role);
  }

  private async revokeRepositoryAccess(workspaceId: string, username: string): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { repoUrl: true },
    });
    for (const project of projects) await this.gitea.removeCollaborator(project.repoUrl, username);
  }
}
