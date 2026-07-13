import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CoursesService } from './courses.service';

describe('CoursesService', () => {
  it('allows only a platform administrator to create a course', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ platformRole: 'user' })) },
    };
    const service = new CoursesService(prisma as never, {} as never);

    await expect(service.create('student', {
      name: 'DevOps Lab', slug: 'devops-lab', description: 'School course',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'student' }, select: { platformRole: true },
    });
  });

  it('stores only a hash of the one-time enrollment code', async () => {
    const createdAt = new Date('2026-07-13T20:00:00.000Z');
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ platformRole: 'admin' })) },
      workspace: { findUnique: jest.fn(async () => null) },
      course: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'course-1', slug: 'devops-lab', name: 'DevOps Lab', description: null,
          workspaceId: 'school-1', enrollmentOpen: true, membershipLocked: false,
          createdAt, _count: { members: 1, teams: 0 }, data,
        })),
      },
    };
    const service = new CoursesService(prisma as never, {} as never);

    const result = await service.create('admin', { name: 'DevOps Lab', slug: 'devops-lab' });
    const data = prisma.course.create.mock.calls[0][0].data as {
      enrollmentCodeHash: string;
    };
    expect(result.enrollmentCode).toMatch(/^INIT-(?:[0-9A-F]{4}-){3}[0-9A-F]{4}$/);
    expect(data.enrollmentCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.enrollmentCodeHash).not.toContain(result.enrollmentCode);
  });

  it('does not disclose a course for an invalid enrollment code', async () => {
    const prisma = {
      course: { findUnique: jest.fn(async () => null) },
    };
    const service = new CoursesService(prisma as never, {} as never);

    await expect(service.join('student', 'INIT-0000-0000-0000-0000'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks self-enrollment after an instructor locks membership', async () => {
    const prisma = {
      course: {
        findUnique: jest.fn(async () => ({
          id: 'course-1', enrollmentOpen: true, membershipLocked: true,
        })),
      },
    };
    const service = new CoursesService(prisma as never, {} as never);

    await expect(service.join('student', 'INIT-0000-0000-0000-0000'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps course membership separate from project authorization', async () => {
    const prisma = {
      courseMember: { findUnique: jest.fn(async () => null) },
    };
    const service = new CoursesService(prisma as never, {} as never);

    await expect(service.detail('outsider', 'course-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.courseMember.findUnique).toHaveBeenCalledWith({
      where: { courseId_userId: { courseId: 'course-1', userId: 'outsider' } },
    });
  });
});
