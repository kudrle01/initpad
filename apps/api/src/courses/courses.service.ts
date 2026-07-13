import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  AddCourseMemberDto,
  CreateCourseDto,
  CreateCourseTeamDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { generateEnrollmentCode, hashEnrollmentCode } from './enrollment-code';

type CourseRole = 'instructor' | 'student';

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(userId: string) {
    const memberships = await this.prisma.courseMember.findMany({
      where: { userId },
      include: {
        course: {
          include: { workspace: true, _count: { select: { members: true, teams: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => this.toSummary(membership.course, membership.role as CourseRole));
  }

  async create(userId: string, dto: CreateCourseDto) {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true },
    });
    if (actor?.platformRole !== 'admin') {
      throw new ForbiddenException('Platform administrator access required to create a course');
    }
    const duplicate = await this.prisma.course.findUnique({ where: { slug: dto.slug } });
    if (duplicate) throw new ConflictException(`Course slug '${dto.slug}' is already taken`);

    const enrollmentCode = generateEnrollmentCode();
    const workspaceSlug = this.courseWorkspaceSlug(dto.slug);
    const workspaceConflict = await this.prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
    if (workspaceConflict) throw new ConflictException(`Workspace slug '${workspaceSlug}' is already taken`);

    const course = await this.prisma.course.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug,
        description: this.optionalText(dto.description),
        enrollmentCodeHash: hashEnrollmentCode(enrollmentCode),
        workspace: {
          create: {
            name: `${dto.name.trim()} · instructors`,
            slug: workspaceSlug,
            type: 'school',
            members: { create: { userId, role: 'owner' } },
          },
        },
        members: { create: { userId, role: 'instructor' } },
      },
      include: { workspace: true, _count: { select: { members: true, teams: true } } },
    });
    return { ...this.toSummary(course, 'instructor'), enrollmentCode };
  }

  async detail(userId: string, courseId: string) {
    const membership = await this.requireMember(userId, courseId);
    const course = await this.courseDetailOrThrow(courseId);
    return this.toDetail(course, membership.role as CourseRole);
  }

  async update(userId: string, courseId: string, dto: UpdateCourseDto) {
    await this.requireInstructor(userId, courseId);
    await this.prisma.course.update({
      where: { id: courseId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: this.optionalText(dto.description) } : {}),
        ...(dto.enrollmentOpen !== undefined ? { enrollmentOpen: dto.enrollmentOpen } : {}),
        ...(dto.membershipLocked !== undefined ? { membershipLocked: dto.membershipLocked } : {}),
      },
    });
    return this.detail(userId, courseId);
  }

  async rotateEnrollmentCode(userId: string, courseId: string) {
    await this.requireInstructor(userId, courseId);
    const enrollmentCode = generateEnrollmentCode();
    await this.prisma.course.update({
      where: { id: courseId },
      data: { enrollmentCodeHash: hashEnrollmentCode(enrollmentCode) },
    });
    return { enrollmentCode };
  }

  async join(userId: string, enrollmentCode: string) {
    const course = await this.courseForCode(enrollmentCode);
    this.assertSelfEnrollmentOpen(course);
    const existing = await this.prisma.courseMember.findUnique({
      where: { courseId_userId: { courseId: course.id, userId } },
    });
    if (existing) throw new ConflictException('You are already a member of this course');
    await this.prisma.courseMember.create({ data: { courseId: course.id, userId, role: 'student' } });
    return this.detail(userId, course.id);
  }

  async addMember(userId: string, courseId: string, dto: AddCourseMemberDto) {
    await this.requireInstructor(userId, courseId);
    const identity = dto.identity.trim();
    const member = await this.prisma.user.findFirst({
      where: { OR: [{ username: identity }, { email: identity.toLowerCase() }] },
    });
    if (!member) throw new NotFoundException(`User '${identity}' not found`);
    const existing = await this.prisma.courseMember.findUnique({
      where: { courseId_userId: { courseId, userId: member.id } },
    });
    if (existing) throw new ConflictException('User is already a course member');

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: { teams: true },
    });
    await this.prisma.courseMember.create({ data: { courseId, userId: member.id, role: dto.role } });
    const granted: string[] = [];
    try {
      if (dto.role === 'instructor') {
        await this.workspaces.grantManagedMember(course.workspaceId, member.id, 'admin');
        granted.push(course.workspaceId);
        for (const team of course.teams) {
          await this.workspaces.grantManagedMember(team.workspaceId, member.id, 'admin');
          granted.push(team.workspaceId);
        }
      }
    } catch (error) {
      for (const workspaceId of granted.reverse()) {
        await this.workspaces.revokeManagedMember(workspaceId, member.id).catch(() => undefined);
      }
      await this.prisma.courseMember.delete({
        where: { courseId_userId: { courseId, userId: member.id } },
      }).catch(() => undefined);
      throw error;
    }
    return this.detail(userId, courseId);
  }

  async removeMember(userId: string, courseId: string, memberId: string) {
    await this.requireInstructor(userId, courseId);
    const member = await this.prisma.courseMember.findUnique({
      where: { courseId_userId: { courseId, userId: memberId } },
      include: { course: { include: { teams: true } } },
    });
    if (!member) throw new NotFoundException('Course member not found');

    const revoked: Array<{ workspaceId: string; role: 'admin' | 'member' }> = [];
    if (member.role === 'instructor') {
      const homeMembership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: member.course.workspaceId, userId: memberId } },
      });
      if (homeMembership?.role === 'owner') {
        throw new BadRequestException('The founding instructor cannot be removed');
      }
      for (const team of member.course.teams) {
        await this.revokeIfPresent(team.workspaceId, memberId, 'admin', revoked);
      }
      await this.revokeIfPresent(member.course.workspaceId, memberId, 'admin', revoked);
    } else if (member.teamId) {
      const team = member.course.teams.find((candidate) => candidate.id === member.teamId);
      if (team) await this.revokeIfPresent(team.workspaceId, memberId, 'member', revoked);
    }

    try {
      await this.prisma.courseMember.delete({
        where: { courseId_userId: { courseId, userId: memberId } },
      });
    } catch (error) {
      for (const entry of revoked) {
        await this.workspaces.grantManagedMember(entry.workspaceId, memberId, entry.role).catch(() => undefined);
      }
      throw error;
    }
    return this.detail(userId, courseId);
  }

  async createTeam(userId: string, courseId: string, dto: CreateCourseTeamDto) {
    const actor = await this.requireMember(userId, courseId);
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        members: { where: { role: 'instructor' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (actor.role === 'student') {
      if (course.membershipLocked) throw new ForbiddenException('Course membership is locked');
      if (actor.teamId) throw new ConflictException('You already belong to a team in this course');
    }
    const founder = course.members[0];
    if (!founder) throw new BadRequestException('Course has no instructor');
    const workspaceSlug = this.teamWorkspaceSlug(course.id, course.slug, dto.slug);
    const duplicate = await this.prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
    if (duplicate) throw new ConflictException('A team with this slug already exists');

    const team = await this.prisma.$transaction(async (tx) => {
      const created = await tx.courseTeam.create({
        data: {
          course: { connect: { id: courseId } },
          workspace: {
            create: {
              name: dto.name.trim(),
              slug: workspaceSlug,
              type: 'team',
              members: {
                create: [
                  { userId: founder.userId, role: 'owner' },
                  ...course.members.slice(1).map((instructor) => ({ userId: instructor.userId, role: 'admin' })),
                  ...(actor.role === 'student' ? [{ userId, role: 'member' }] : []),
                ],
              },
            },
          },
        },
        include: { workspace: true },
      });
      if (actor.role === 'student') {
        const assigned = await tx.courseMember.updateMany({
          where: { courseId, userId, role: 'student', teamId: null },
          data: { teamId: created.id },
        });
        if (assigned.count !== 1) throw new ConflictException('You already belong to a team');
      }
      return created;
    });
    return { id: team.id, workspaceId: team.workspaceId, name: team.workspace.name };
  }

  async joinTeam(userId: string, courseId: string, teamId: string) {
    const actor = await this.requireMember(userId, courseId);
    if (actor.role !== 'student') throw new BadRequestException('Only students join course teams');
    if (actor.teamId) throw new ConflictException('You already belong to a team in this course');
    const course = await this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    if (course.membershipLocked) throw new ForbiddenException('Course membership is locked');
    const team = await this.prisma.courseTeam.findFirst({ where: { id: teamId, courseId } });
    if (!team) throw new NotFoundException('Course team not found');

    await this.workspaces.grantManagedMember(team.workspaceId, userId, 'member');
    try {
      const assigned = await this.prisma.courseMember.updateMany({
        where: { courseId, userId, role: 'student', teamId: null },
        data: { teamId },
      });
      if (assigned.count !== 1) throw new ConflictException('You already belong to a team');
    } catch (error) {
      await this.workspaces.revokeManagedMember(team.workspaceId, userId).catch(() => undefined);
      throw error;
    }
    return this.detail(userId, courseId);
  }

  async removeTeamMember(userId: string, courseId: string, teamId: string, memberId: string) {
    const actor = await this.requireMember(userId, courseId);
    if (actor.role !== 'instructor' && userId !== memberId) {
      throw new ForbiddenException('Only an instructor can remove another student from a team');
    }
    const course = await this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    if (actor.role === 'student' && course.membershipLocked) {
      throw new ForbiddenException('Course membership is locked');
    }
    const member = await this.prisma.courseMember.findUnique({
      where: { courseId_userId: { courseId, userId: memberId } },
    });
    if (!member || member.role !== 'student' || member.teamId !== teamId) {
      throw new NotFoundException('Student is not a member of this team');
    }
    const team = await this.prisma.courseTeam.findFirst({ where: { id: teamId, courseId } });
    if (!team) throw new NotFoundException('Course team not found');

    await this.workspaces.revokeManagedMember(team.workspaceId, memberId);
    try {
      await this.prisma.courseMember.update({
        where: { courseId_userId: { courseId, userId: memberId } },
        data: { teamId: null },
      });
    } catch (error) {
      await this.workspaces.grantManagedMember(team.workspaceId, memberId, 'member').catch(() => undefined);
      throw error;
    }
    return this.detail(userId, courseId);
  }

  private async requireMember(userId: string, courseId: string) {
    const membership = await this.prisma.courseMember.findUnique({
      where: { courseId_userId: { courseId, userId } },
    });
    if (!membership) throw new ForbiddenException('Course membership required');
    return membership;
  }

  private async requireInstructor(userId: string, courseId: string) {
    const membership = await this.requireMember(userId, courseId);
    if (membership.role !== 'instructor') throw new ForbiddenException('Course instructor access required');
    return membership;
  }

  private async courseForCode(code: string) {
    if (!code.trim()) throw new BadRequestException('Enrollment code is required');
    const course = await this.prisma.course.findUnique({
      where: { enrollmentCodeHash: hashEnrollmentCode(code) },
    });
    if (!course) throw new BadRequestException('Enrollment code is invalid');
    return course;
  }

  private assertSelfEnrollmentOpen(course: { enrollmentOpen: boolean; membershipLocked: boolean }) {
    if (!course.enrollmentOpen) throw new ForbiddenException('Course enrollment is closed');
    if (course.membershipLocked) throw new ForbiddenException('Course membership is locked');
  }

  private async courseDetailOrThrow(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        workspace: true,
        members: { include: { user: true }, orderBy: { createdAt: 'asc' } },
        teams: { include: { workspace: true }, orderBy: { createdAt: 'asc' } },
        _count: { select: { members: true, teams: true } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  private toSummary(
    course: {
      id: string; slug: string; name: string; description: string | null;
      workspaceId: string; enrollmentOpen: boolean; membershipLocked: boolean;
      createdAt: Date; _count: { members: number; teams: number };
    },
    role: CourseRole,
  ) {
    return {
      id: course.id,
      slug: course.slug,
      name: course.name,
      description: course.description,
      workspaceId: course.workspaceId,
      role,
      enrollmentOpen: course.enrollmentOpen,
      membershipLocked: course.membershipLocked,
      memberCount: course._count.members,
      teamCount: course._count.teams,
      createdAt: course.createdAt.toISOString(),
    };
  }

  private toDetail(course: Awaited<ReturnType<CoursesService['courseDetailOrThrow']>>, role: CourseRole) {
    const members = course.members.map((member) => ({
      userId: member.userId,
      username: member.user.username,
      name: member.user.name,
      role: member.role as CourseRole,
      teamId: member.teamId,
      createdAt: member.createdAt.toISOString(),
    }));
    return {
      ...this.toSummary(course, role),
      instructors: members.filter((member) => member.role === 'instructor'),
      students: members.filter((member) => member.role === 'student'),
      teams: course.teams.map((team) => ({
        id: team.id,
        workspaceId: team.workspaceId,
        name: team.workspace.name,
        slug: team.workspace.slug,
        createdAt: team.createdAt.toISOString(),
        members: members.filter((member) => member.teamId === team.id),
      })),
    };
  }

  private async revokeIfPresent(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member',
    revoked: Array<{ workspaceId: string; role: 'admin' | 'member' }>,
  ) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) return;
    await this.workspaces.revokeManagedMember(workspaceId, userId);
    revoked.push({ workspaceId, role });
  }

  private courseWorkspaceSlug(courseSlug: string): string {
    return `school-${courseSlug}`;
  }

  private teamWorkspaceSlug(courseId: string, courseSlug: string, teamSlug: string): string {
    const suffix = createHash('sha256').update(`${courseId}:${teamSlug}`).digest('hex').slice(0, 6);
    return `c-${courseSlug.slice(0, 14)}-${teamSlug.slice(0, 14)}-${suffix}`;
  }

  private optionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }
}
