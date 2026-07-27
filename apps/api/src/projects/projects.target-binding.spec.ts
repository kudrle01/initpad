import { ProjectsService } from './projects.service';
import type { TargetRow } from '../targets/targets.service';

const baseTarget: TargetRow = {
  id: 'builtin-docker',
  name: 'Company Docker',
  kind: 'docker',
  scope: 'builtin',
  capabilities: 'static,node,php,python',
  host: null,
  port: null,
  username: null,
  auth: null,
  secret: null,
  remotePath: null,
  publicUrl: null,
  verifiedAt: new Date(),
  ownerId: null,
  workspaceId: null,
  createdAt: new Date(),
};

describe('ProjectsService target binding', () => {
  it('keeps the releasable build and requires an explicit deploy on the new target', async () => {
    const newTarget: TargetRow = {
      ...baseTarget,
      id: 'eso-sftp',
      name: 'ESO',
      kind: 'sftp',
      scope: 'user',
      capabilities: 'static,php',
      workspaceId: 'workspace-1',
    };
    const environment = {
      id: 'environment-1',
      targetId: baseTarget.id,
      provider: 'docker',
      status: 'running',
      statusReason: null,
      version: 'a'.repeat(40),
      buildArtifactId: 'artifact-1',
      activeOperationId: null,
      target: baseTarget,
      allocation: null,
    };
    const prisma = {
      project: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'project-1',
          workspaceId: 'workspace-1',
          templateId: 'nette',
          scmProvider: 'github',
          scmRepositoryId: '101',
          scmOwner: 'acme',
          scmRepositoryName: 'web',
          scmFullName: 'acme/web',
          scmDefaultBranch: 'main',
          scmInstallationId: 'installation-1',
          repoUrl: 'https://github.com/acme/web',
        })),
      },
      environment: {
        findUnique: jest.fn(async () => environment),
        count: jest.fn(async () => 0),
        update: jest.fn(async (_input: unknown) => environment),
      },
      targetAllocation: {
        findUnique: jest.fn(async () => ({
          id: 'allocation-eso',
          targetId: newTarget.id,
          namespace: 'workspace-1',
          rootPath: '/www',
          publicUrl: 'https://eso.example.test',
          capabilities: 'static,php',
          status: 'active',
          maxEnvironments: 50,
          _count: { environments: 0 },
        })),
      },
    };
    const deployment = { teardown: jest.fn(async () => undefined) };
    const service = new ProjectsService(
      prisma as never,
      {
        get: jest.fn(() => ({
          id: 'nette',
          runtime: 'php',
          compatibleProviders: ['docker', 'sftp'],
        })),
      } as never,
      {} as never,
      deployment as never,
      {
        listEntities: jest.fn(async () => [baseTarget, newTarget]),
        parseCaps: (value: string) => value.split(','),
        connectionForTarget: jest.fn(() => undefined),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);

    await service.bindTarget('project-1', 'dev', newTarget.id);

    expect(deployment.teardown).toHaveBeenCalledTimes(1);
    expect(prisma.environment.update).toHaveBeenCalledWith({
      where: { projectId_name: { projectId: 'project-1', name: 'dev' } },
      data: {
        targetId: newTarget.id,
        allocationId: 'allocation-eso',
        provider: 'sftp',
        status: 'empty',
        url: null,
        statusReason: null,
        allocatedPort: null,
        deploymentRequired: true,
      },
    });
    const update = prisma.environment.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(update.data).not.toHaveProperty('version');
    expect(update.data).not.toHaveProperty('buildArtifactId');
  });
});
