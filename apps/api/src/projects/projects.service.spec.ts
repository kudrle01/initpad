import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

describe('ProjectsService project deletion', () => {
  it('requires an explicit acknowledgement for production cleanup', async () => {
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'project-1',
          environments: [
            {
              id: 'prod-1',
              name: 'prod',
              status: 'running',
              version: 'abc123',
              url: 'https://example.test/app',
              target: null,
            },
          ],
          owner: null,
        }),
      },
    };
    const deployment = { teardown: jest.fn() };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      deployment as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.remove('project-1', {
        deleteRemoteRepo: false,
        confirmProduction: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deployment.teardown).not.toHaveBeenCalled();
  });
});
