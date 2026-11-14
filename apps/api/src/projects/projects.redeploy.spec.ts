import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const SHA = 'c'.repeat(40);

function make(
  environment: Record<string, unknown> | null,
  attempt: Record<string, unknown> | null,
) {
  const prisma = {
    environment: { findUnique: jest.fn(async () => environment) },
    deploymentOperation: { findFirst: jest.fn(async () => attempt) },
  };
  const service = new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { provider: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const schedule = jest
    .spyOn(
      service as unknown as { scheduleDeployment: () => Promise<string> },
      'scheduleDeployment',
    )
    .mockResolvedValue('operation-1');
  jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
  return { service, prisma, schedule };
}

// Regression suite for audit P3: after a failed first deployment, Redeploy
// answered "nothing to redeploy" although a verified build existed.
describe('ProjectsService.redeploy', () => {
  it('redeploys the current version as before', async () => {
    const { service, schedule } = make(
      { id: 'env-dev', version: SHA, buildArtifactId: 'artifact-1' },
      null,
    );

    await service.redeploy('project-1', 'dev', 'user-1');

    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'dev',
      SHA,
      true,
      'redeploy',
      'artifact-1',
      'user-1',
    );
  });

  it('retries the last verified artifact after a failed first deployment', async () => {
    const { service, prisma, schedule } = make(
      { id: 'env-dev', version: null, buildArtifactId: null, status: 'failed' },
      { version: SHA, buildArtifactId: 'artifact-2' },
    );

    await service.redeploy('project-1', 'dev', 'user-1');

    expect(prisma.deploymentOperation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          environmentId: 'env-dev',
          version: { not: null },
          buildArtifact: { status: 'available', storageKind: 'object-store' },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'dev',
      SHA,
      true,
      'redeploy',
      'artifact-2',
      'user-1',
    );
  });

  it('explains what to do when no verified build exists yet', async () => {
    const { service, schedule } = make(
      { id: 'env-dev', version: null, buildArtifactId: null, status: 'failed' },
      null,
    );

    await expect(service.redeploy('project-1', 'dev')).rejects.toThrow(
      new BadRequestException(
        "Environment 'dev' has nothing to redeploy. Push a commit or run CI again.",
      ),
    );
    expect(schedule).not.toHaveBeenCalled();
  });
});
