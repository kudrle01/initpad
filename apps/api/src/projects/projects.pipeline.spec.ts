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
    listCommitStatuses: jest.fn(async () => [
      { context: 'build', status: 'success', targetUrl: 'https://x/build' },
      { context: 'test', status: 'success', targetUrl: 'https://x/test' },
      { context: 'docker build', status: 'success', targetUrl: 'https://x/docker' },
      // The runner callback failed, but the subsequent platform recovery may
      // still publish the already verified artifact successfully.
      { context: 'deploy', status: 'failure', targetUrl: 'https://x/run-77/deploy' },
    ]),
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
  );
  jest.spyOn(service, 'get').mockResolvedValue({
    ...project,
    environments: [environment],
  } as never);
  return { service, scm };
}

describe('ProjectsService deployment pipeline projection', () => {
  it('binds stages to the artifact run and marks a recovered deployment successful', async () => {
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

    expect(scm.listCommitStatuses).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }), sha, expect.anything(), '77',
    );
    expect(commits[0]?.pipeline.find((stage) => stage.name === 'deploy')).toEqual({
      name: 'deploy', status: 'success', url: 'https://x/run-77/deploy',
    });
  });

  it('shows deploy as pending after a target change and running during publication', async () => {
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
      (await pending.service.getCommits(project.id))[0]?.pipeline.find((stage) => stage.name === 'deploy')?.status,
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
      (await running.service.getCommits(project.id))[0]?.pipeline.find((stage) => stage.name === 'deploy')?.status,
    ).toBe('running');
  });
});
