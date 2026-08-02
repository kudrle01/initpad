import { ProjectsService } from './projects.service';

const sha = 'a'.repeat(40);
const project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'api',
  templateId: 'node-api',
  repoPath: '/tmp/api',
  repoUrl: 'https://github.com/acme/api',
  scm: {
    provider: 'github' as const,
    repositoryId: '101',
    owner: 'acme',
    name: 'api',
    fullName: 'acme/api',
    defaultBranch: 'main',
    repoUrl: 'https://github.com/acme/api',
    installationId: 'installation-1',
  },
  createdAt: new Date().toISOString(),
  lastCommit: 'init',
};

function make(
  environment: Record<string, unknown>,
  operation: Record<string, unknown>,
  statuses = [
    { context: 'build', status: 'success', targetUrl: 'https://x/build' },
    { context: 'test', status: 'success', targetUrl: 'https://x/test' },
    { context: 'docker build', status: 'success', targetUrl: 'https://x/docker' },
    // The runner callback failed, but the subsequent platform recovery may
    // still publish the already verified artifact successfully.
    { context: 'deploy', status: 'failure', targetUrl: 'https://x/run-77/deploy' },
  ],
) {
  const prisma = {
    project: {
      findUnique: jest.fn(async () => ({ id: project.id, owner: null })),
    },
    deploymentOperation: {
      findMany: jest.fn(async () => [operation]),
    },
  };
  const scm = {
    listCommits: jest.fn(async () => [{ sha, message: 'init', author: 'Dev', date: 'now' }]),
    listCommitStatuses: jest.fn(async () => statuses),
  };
  const service = new ProjectsService(
    prisma as never,
    { get: jest.fn(() => ({ artifact: 'runtime' })) } as never,
    {} as never,
    {} as never,
    {} as never,
    { provider: jest.fn(() => scm) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(service, 'get').mockResolvedValue({
    ...project,
    environments: [environment],
  } as never);
  return { service, scm };
}

describe('ProjectsService deployment pipeline projection', () => {
  it('distinguishes a queued workflow from a runner that actually started it', async () => {
    const pendingStatuses = [
      { context: 'build', status: 'pending', targetUrl: 'https://x/build' },
      { context: 'test', status: 'pending', targetUrl: 'https://x/test' },
      { context: 'docker build', status: 'pending', targetUrl: 'https://x/docker' },
      { context: 'deploy', status: 'pending', targetUrl: 'https://x/deploy' },
    ];
    const operation = {
      version: sha, status: 'running', createdAt: new Date(), buildArtifact: null,
    };
    const queued = make(
      {
        name: 'dev', status: 'deploying', version: null, deploymentRequired: false,
        statusReason: 'Waiting for an available CI runner', artifact: null,
      },
      operation,
      pendingStatuses,
    );
    expect((await queued.service.getCommits(project.id))[0]?.pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'build', status: 'pending' }),
        expect.objectContaining({ name: 'publish', status: 'pending' }),
      ]),
    );

    const started = make(
      {
        name: 'dev', status: 'deploying', version: null, deploymentRequired: false,
        statusReason: 'CI runner started the build', artifact: null,
      },
      operation,
      pendingStatuses,
    );
    expect((await started.service.getCommits(project.id))[0]?.pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'build', status: 'running' }),
        expect.objectContaining({ name: 'publish', status: 'pending' }),
      ]),
    );
  });

  it('keeps a failed runner handoff and records recovered publication separately', async () => {
    const { service, scm } = make(
      {
        name: 'dev', status: 'running', version: sha, deploymentRequired: false,
        artifact: { id: 'artifact-1', provider: 'github-actions', digest: 'd'.repeat(64), runId: '77' },
      },
      {
        version: sha, status: 'succeeded', createdAt: new Date(),
        buildArtifact: { providerRunId: '77' },
      },
    );

    const commits = await service.getCommits(project.id);

    expect(scm.listCommits).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }), expect.anything(), 20,
    );
    expect(scm.listCommitStatuses).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }), sha, expect.anything(), '77',
    );
    expect(commits[0]?.pipeline.find((stage) => stage.name === 'deploy')).toEqual({
      name: 'deploy', status: 'failed', url: 'https://x/run-77/deploy',
    });
    expect(commits[0]?.pipeline.find((stage) => stage.name === 'publish')).toEqual({
      name: 'publish', status: 'success', url: null, source: 'platform',
    });
  });

  it('shows publication as pending after a target change and running during upload', async () => {
    const pending = make(
      {
        name: 'dev', status: 'empty', version: sha, deploymentRequired: true,
        artifact: { id: 'artifact-1', provider: 'github-actions', digest: 'd'.repeat(64), runId: '77' },
      },
      {
        version: sha, status: 'succeeded', createdAt: new Date(),
        buildArtifact: { providerRunId: '77' },
      },
    );
    expect(
      (await pending.service.getCommits(project.id))[0]?.pipeline.find((stage) => stage.name === 'publish')?.status,
    ).toBe('pending');

    const running = make(
      {
        name: 'dev', status: 'deploying', version: sha, deploymentRequired: true,
        artifact: { id: 'artifact-1', provider: 'github-actions', digest: 'd'.repeat(64), runId: '77' },
      },
      {
        version: sha, status: 'running', createdAt: new Date(),
        buildArtifact: { providerRunId: '77' },
      },
    );
    expect(
      (await running.service.getCommits(project.id))[0]?.pipeline.find((stage) => stage.name === 'publish')?.status,
    ).toBe('running');
  });

  it('returns provider-neutral deployment activity with its artifact run binding', async () => {
    const startedAt = new Date('2026-07-20T20:11:33.000Z');
    const finishedAt = new Date('2026-07-20T20:11:37.000Z');
    const prisma = {
      deploymentOperation: {
        findMany: jest.fn(async () => [{
          id: 'operation-1', kind: 'redeploy', status: 'succeeded', version: sha,
          message: 'Verifying deployment', startedAt, finishedAt,
          targetName: 'ESO school server', environment: { name: 'dev' },
          buildArtifact: { providerRunId: '77' },
        }]),
      },
    };
    const service = new ProjectsService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never,
    );

    await expect(service.deploymentHistory(project.id, 7)).resolves.toEqual([{
      id: 'operation-1', environment: 'dev', target: 'ESO school server',
      kind: 'redeploy', status: 'succeeded', version: sha,
      message: 'Verifying deployment',
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
      artifactRunId: '77',
    }]);
    expect(prisma.deploymentOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 7 }),
    );
  });

  it('caps commit and deployment history requests at 100 rows', async () => {
    const { service, scm } = make(
      { name: 'dev', status: 'empty', version: null, deploymentRequired: false },
      { version: sha, status: 'succeeded', createdAt: new Date(), buildArtifact: null },
    );

    await service.getCommits(project.id, 500);
    expect(scm.listCommits).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }), expect.anything(), 100,
    );

    const prisma = { deploymentOperation: { findMany: jest.fn(async () => []) } };
    const historyService = new ProjectsService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
      {} as never,
    );
    await historyService.deploymentHistory(project.id, 500);
    expect(prisma.deploymentOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});
