import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hashToken } from '../common/token';
import { ProjectsService } from './projects.service';

function serviceWith(projects: Record<string, unknown>[]) {
  const prisma = {
    project: {
      findMany: jest.fn(async ({ where }: { where: { scmFullName: string } }) =>
        projects.filter((project) => project.scmFullName === where.scmFullName),
      ),
    },
    environment: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const service = new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('ProjectsService CI runner start signal', () => {
  it('keeps simultaneous projects isolated by repository and secret', async () => {
    const firstToken = 'first-repository-secret';
    const secondToken = 'second-repository-secret';
    const { service, prisma } = serviceWith([
      {
        id: 'project-1',
        scmFullName: 'acme/one',
        scmDefaultBranch: 'main',
        ciDeployTokenHash: hashToken(firstToken),
      },
      {
        id: 'project-2',
        scmFullName: 'acme/two',
        scmDefaultBranch: 'main',
        ciDeployTokenHash: hashToken(secondToken),
      },
    ]);

    await Promise.all([
      service.ciStarted('acme/one', 'a'.repeat(40), 'main', firstToken),
      service.ciStarted('acme/two', 'b'.repeat(40), 'main', secondToken),
    ]);

    expect(prisma.environment.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ projectId: 'project-1', version: null }),
      data: { statusReason: 'CI runner started the build' },
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ projectId: 'project-2', version: null }),
      data: { statusReason: 'CI runner started the build' },
    });
  });

  it('rejects a different repository secret before changing state', async () => {
    const { service, prisma } = serviceWith([
      {
        id: 'project-1',
        scmFullName: 'acme/one',
        scmDefaultBranch: 'main',
        ciDeployTokenHash: hashToken('correct-secret'),
      },
    ]);

    await expect(
      service.ciStarted('acme/one', 'a'.repeat(40), 'main', 'wrong-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.environment.updateMany).not.toHaveBeenCalled();
  });

  it('returns a retryable failure while the project transaction is not visible yet', async () => {
    const { service, prisma } = serviceWith([]);

    await expect(
      service.ciStarted('acme/just-created', 'a'.repeat(40), 'main', 'secret'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.environment.updateMany).not.toHaveBeenCalled();
  });
});
