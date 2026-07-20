import { ProjectsService } from './projects.service';

const projectRow = {
  id: 'project-1',
  scmProvider: 'github',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'api',
  scmFullName: 'acme/api',
  scmDefaultBranch: 'main',
  scmInstallationId: 'installation-1',
  repoUrl: 'https://github.com/acme/api',
};

function make(prisma: Record<string, unknown>, deployment: Record<string, unknown> = {}) {
  return new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    deployment as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('ProjectsService immutable artifact binding', () => {
  it('promotes the exact artifact currently running in the source environment', async () => {
    const prisma = {
      environment: {
        findUniqueOrThrow: jest.fn(async () => ({ buildArtifactId: 'artifact-1' })),
      },
    };
    const service = make(prisma);
    jest.spyOn(service, 'get').mockResolvedValue({
      id: 'project-1',
      environments: [
        { name: 'dev', status: 'running', version: 'a'.repeat(40), artifact: { id: 'artifact-1' } },
      ],
    } as never);
    const schedule = jest.spyOn(service as any, 'scheduleDeployment').mockResolvedValue(undefined);

    await service.promote('project-1', 'test');

    expect(schedule).toHaveBeenCalledWith(
      'project-1',
      'test',
      'a'.repeat(40),
      true,
      'promote',
      'artifact-1',
    );
  });

  it('reuses a failed GitHub deployment only when its exact local artifact exists', async () => {
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1', status: 'failed', activeOperationId: null,
        })),
      },
      project: { findUniqueOrThrow: jest.fn(async () => projectRow) },
      deploymentOperation: {
        findFirst: jest.fn(async () => ({
          version: 'a'.repeat(40), buildArtifactId: 'artifact-1',
        })),
      },
      buildArtifact: {
        findFirst: jest.fn(async () => ({ storageRef: 'ghcr.io/acme/api:immutable-run' })),
      },
    };
    const deployment = { hasImage: jest.fn(async () => true) };
    const service = make(prisma, deployment);
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
    const schedule = jest.spyOn(service as any, 'scheduleDeployment').mockResolvedValue(undefined);

    await service.runAgain('project-1');

    expect(deployment.hasImage).toHaveBeenCalledWith('ghcr.io/acme/api:immutable-run');
    expect(schedule).toHaveBeenCalledWith(
      'project-1', 'dev', 'a'.repeat(40), true, 'retry', 'artifact-1',
    );
  });
});
