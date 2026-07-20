import { ProjectsService } from './projects.service';
import { config } from '../config';

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

function make(
  prisma: Record<string, unknown>,
  deployment: Record<string, unknown> = {},
  workspaceScm: Record<string, unknown> = {},
) {
  return new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    deployment as never,
    {} as never,
    workspaceScm as never,
    {} as never,
    {} as never,
  );
}

describe('ProjectsService immutable artifact binding', () => {
  const savedPublicUrl = config.ci.publicUrl;

  afterEach(() => {
    config.ci.publicUrl = savedPublicUrl;
  });

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

  it('recovers an existing tested GitHub artifact instead of starting CI again', async () => {
    const sha = 'a'.repeat(40);
    const artifact = {
      provider: 'github-actions',
      providerArtifactId: '901',
      providerRunId: '456',
      name: 'initpad-image.tar',
      digest: 'd'.repeat(64),
      commitSha: sha,
      sizeBytes: 123,
      expiresAt: new Date('2026-07-21T00:00:00Z'),
    };
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1', status: 'failed', activeOperationId: null,
          provider: 'sftp', target: { name: 'ESO' },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      project: {
        findUniqueOrThrow: jest.fn(async () => projectRow),
        findUnique: jest.fn(async () => ({ ...projectRow, owner: null })),
      },
      deploymentOperation: { findFirst: jest.fn(async () => null) },
    };
    const scm = {
      listCommits: jest.fn(async () => [{ sha }]),
      findBuildArtifact: jest.fn(async () => artifact),
      createRetryTag: jest.fn(),
    };
    const service = make(prisma, {}, { provider: jest.fn(() => scm) });
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
    jest.spyOn(service as any, 'beginOperation').mockResolvedValue('operation-1');
    const queue = jest.spyOn(service as any, 'queueArtifactIngestion').mockResolvedValue(undefined);

    await service.runAgain('project-1');

    expect(scm.findBuildArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', fullName: 'acme/api' }),
      sha,
      'initpad-image.tar',
    );
    expect(queue).toHaveBeenCalledWith('project-1', expect.anything(), artifact, 'operation-1');
    expect(scm.createRetryTag).not.toHaveBeenCalled();
  });

  it('does not start another GitHub workflow when callback is local and no artifact exists', async () => {
    config.ci.publicUrl = 'http://localhost:8080';
    const sha = 'a'.repeat(40);
    const prisma = {
      environment: {
        findUnique: jest.fn(async () => ({
          id: 'env-1', status: 'failed', activeOperationId: null,
          provider: 'sftp', target: { name: 'ESO' },
        })),
      },
      project: {
        findUniqueOrThrow: jest.fn(async () => projectRow),
        findUnique: jest.fn(async () => ({ ...projectRow, owner: null })),
      },
      deploymentOperation: { findFirst: jest.fn(async () => null) },
    };
    const scm = {
      listCommits: jest.fn(async () => [{ sha }]),
      findBuildArtifact: jest.fn(async () => null),
      createRetryTag: jest.fn(),
    };
    const service = make(prisma, {}, { provider: jest.fn(() => scm) });

    await expect(service.runAgain('project-1')).rejects.toThrow(
      'No reusable tested artifact was found',
    );
    expect(scm.createRetryTag).not.toHaveBeenCalled();
  });
});
