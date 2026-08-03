import { ProjectRow, projectView } from './project-view';

function row(): ProjectRow {
  return {
    id: 'project-1',
    workspaceId: 'workspace-1',
    name: 'api',
    templateId: 'node-api',
    repoPath: '/tmp/api',
    repoUrl: 'https://github.com/acme/api',
    scmProvider: 'github',
    scmRepositoryId: '101',
    scmOwner: 'acme',
    scmRepositoryName: 'api',
    scmFullName: 'acme/api',
    scmDefaultBranch: 'main',
    scmInstallationId: 'installation-1',
    lastCommit: 'init',
    createdAt: new Date('2026-08-03T08:00:00.000Z'),
    environments: [
      {
        name: 'prod',
        order: 3,
        provider: 'sftp',
        status: 'running',
        version: 'b'.repeat(40),
        url: 'https://apps.example.test/api',
        statusReason: null,
        deploymentRequired: false,
        target: {
          id: 'target-prod',
          name: 'Company host',
          kind: 'sftp',
          scope: 'user',
          host: 'sftp.example.test',
        },
        buildArtifact: null,
      },
      {
        name: 'dev',
        order: 1,
        provider: 'docker',
        status: 'running',
        version: 'a'.repeat(40),
        url: 'http://stale-vm.test:32774',
        statusReason: null,
        deploymentRequired: false,
        target: {
          id: 'target-dev',
          name: 'Local Docker',
          kind: 'docker',
          scope: 'builtin',
          host: null,
        },
        buildArtifact: {
          id: 'artifact-1',
          sourceProvider: 'github-actions',
          digest: 'd'.repeat(64),
          providerRunId: '77',
        },
      },
    ],
  } as unknown as ProjectRow;
}

describe('projectView', () => {
  it('sorts environments without mutating the persistence row', () => {
    const persistenceRow = row();

    const project = projectView(persistenceRow, 'initpad.example.test');

    expect(project.environments.map((environment) => environment.name)).toEqual(['dev', 'prod']);
    expect(persistenceRow.environments.map((environment) => environment.name)).toEqual([
      'prod',
      'dev',
    ]);
  });

  it('refreshes built-in URLs while preserving user-owned target URLs', () => {
    const project = projectView(row(), 'initpad.example.test');

    expect(project.environments.find(({ name }) => name === 'dev')?.url).toBe(
      'http://initpad.example.test:32774',
    );
    expect(project.environments.find(({ name }) => name === 'prod')?.url).toBe(
      'https://apps.example.test/api',
    );
  });

  it('projects immutable SCM and artifact identities into the API contract', () => {
    const project = projectView(row(), 'initpad.example.test');

    expect(project.scm).toEqual(
      expect.objectContaining({
        provider: 'github',
        repositoryId: '101',
        fullName: 'acme/api',
        installationId: 'installation-1',
      }),
    );
    expect(project.environments[0]?.artifact).toEqual({
      id: 'artifact-1',
      provider: 'github-actions',
      digest: 'd'.repeat(64),
      runId: '77',
    });
  });
});
