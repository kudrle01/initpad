import { config } from '../config';
import { hashToken } from '../common/token';
import { ProjectRepositoryIdentity } from './project-repository-identity';

const SHA = 'a'.repeat(40);

type Row = Record<string, unknown> & { id: string };

function project(overrides: Record<string, unknown> = {}): Row {
  return {
    id: 'project-1',
    name: 'api',
    workspaceId: 'ws1',
    scmProvider: 'github',
    scmRepositoryId: '101',
    scmOwner: 'acme',
    scmRepositoryName: 'api',
    scmFullName: 'acme/api',
    scmDefaultBranch: 'main',
    scmInstallationId: 'installation-1',
    repoUrl: 'https://github.com/acme/api',
    deploymentKey: 'acme-api',
    ciDeployTokenHash: hashToken('repository-secret'),
    owner: null,
    scmInstallation: { accountLogin: 'acme', deletedAt: null },
    ...overrides,
  };
}

function coordinates(owner: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    provider: 'github' as const,
    repositoryId: '101',
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch: 'main',
    repoUrl: `https://github.com/${owner}/${name}`,
    installationId: 'installation-1',
    ...overrides,
  };
}

function make(projects: Row[], artifacts: Row[] = [], scm: Record<string, unknown> = {}) {
  const prisma = {
    project: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          projects.find((row) => row.id === where.id) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ('ciDeployTokenHash' in where) {
          return projects.find((row) => row.ciDeployTokenHash === where.ciDeployTokenHash) ?? null;
        }
        const except = (where.NOT as { id: string } | undefined)?.id;
        return (
          projects.find(
            (row) =>
              row.workspaceId === where.workspaceId && row.name === where.name && row.id !== except,
          ) ?? null
        );
      }),
      findMany: jest.fn(async () => projects),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          Object.assign(projects.find((row) => row.id === where.id) ?? {}, data),
      ),
    },
    buildArtifact: {
      findMany: jest.fn(async ({ where }: { where: { projectId: string } }) =>
        artifacts.filter((row) => row.projectId === where.projectId && row.imageRef == null),
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          Object.assign(artifacts.find((row) => row.id === where.id) ?? {}, data),
      ),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: typeof prisma) => unknown) =>
    run(prisma),
  );
  const audit = { record: jest.fn(async () => undefined) };
  const identity = new ProjectRepositoryIdentity(
    prisma as never,
    { provider: jest.fn(() => scm) } as never,
    () => ({ username: 'acme', token: '' }),
    audit as never,
  );
  return { identity, prisma, audit };
}

describe('ProjectRepositoryIdentity', () => {
  it('follows a rename while the workload key and earlier builds keep their identity', async () => {
    const row = project();
    const artifacts: Row[] = [
      {
        id: 'unpinned',
        projectId: 'project-1',
        sourceProvider: 'github-actions',
        commitSha: SHA,
        providerRunId: '7',
        imageRef: null,
      },
      {
        id: 'pinned',
        projectId: 'project-1',
        sourceProvider: 'github-actions',
        commitSha: SHA,
        providerRunId: '8',
        imageRef: 'ghcr.io/acme/first-name:pinned',
      },
    ];
    const { identity, audit } = make([row], artifacts);

    await expect(identity.apply('project-1', coordinates('acme', 'api-2'))).resolves.toBe(true);

    expect(row).toMatchObject({
      name: 'api-2',
      scmRepositoryName: 'api-2',
      scmFullName: 'acme/api-2',
      repoUrl: 'https://github.com/acme/api-2',
      // Containers, SFTP paths and Agent workloads stay where they are.
      deploymentKey: 'acme-api',
    });
    // The archive of the earlier build is tagged with the previous name.
    expect(artifacts[0].imageRef).toBe(`ghcr.io/acme/api:${SHA}-7`);
    expect(artifacts[1].imageRef).toBe('ghcr.io/acme/first-name:pinned');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.repository_renamed',
        resourceId: 'project-1',
        resourceName: 'api-2',
        details: { previousRepository: 'acme/api', repository: 'acme/api-2' },
      }),
      expect.anything(),
    );
  });

  it('stores the key a legacy row still derives before its coordinates change', async () => {
    const row = project({
      deploymentKey: null,
      scmOwner: 'Acme.Team',
      scmFullName: 'Acme.Team/api',
    });
    const { identity } = make([row]);

    await identity.apply('project-1', coordinates('acme-team', 'api'));

    expect(row.deploymentKey).toBe('acme-team-api');
    expect(row.scmOwner).toBe('acme-team');
  });

  it('pins a Gitea registry build to the name it was pushed under', async () => {
    const savedHost = config.registry.host;
    config.registry.host = 'git.test';
    try {
      const row = project({ scmProvider: 'gitea', scmInstallationId: null });
      const artifacts: Row[] = [
        {
          id: 'oci',
          projectId: 'project-1',
          sourceProvider: 'gitea-oci',
          commitSha: SHA,
          providerRunId: 'registry',
          imageRef: null,
        },
      ];
      const { identity } = make([row], artifacts);

      await identity.apply(
        'project-1',
        coordinates('acme', 'renamed', { provider: 'gitea', installationId: null }),
      );

      expect(artifacts[0].imageRef).toBe(`git.test/acme/api:${SHA}`);
    } finally {
      config.registry.host = savedHost;
    }
  });

  it.each([
    ['is not a valid project name', 'Api.Service', []],
    ['is already used in the workspace', 'web', [project({ id: 'project-2', name: 'web' })]],
  ])('keeps the project name when the new repository name %s', async (_case, name, others) => {
    const row = project();
    const { identity } = make([row, ...others]);

    await identity.apply('project-1', coordinates('acme', name));

    expect(row.name).toBe('api');
    expect(row.scmRepositoryName).toBe(name);
  });

  it('changes nothing for unchanged coordinates or for a different repository', async () => {
    const row = project();
    const { identity, prisma, audit } = make([row]);

    await expect(identity.apply('project-1', coordinates('acme', 'api'))).resolves.toBe(false);
    // The stored name now belongs to another repository with its own ID.
    await expect(
      identity.apply('project-1', coordinates('acme', 'api', { repositoryId: '999' })),
    ).resolves.toBe(false);

    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records a default-branch change without treating it as a rename', async () => {
    const row = project();
    const { identity, prisma, audit } = make([row]);

    await identity.apply('project-1', coordinates('acme', 'api', { defaultBranch: 'trunk' }));

    expect(row.scmDefaultBranch).toBe('trunk');
    expect(prisma.buildArtifact.findMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(['missing', 'unknown'])('reports a %s repository without writing', async (state) => {
    const row = project();
    const scm = { resolveRepository: jest.fn(async () => ({ state })) };
    const { identity, prisma } = make([row], [], scm);

    await expect(identity.refresh(row as never)).resolves.toBe(state);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('finds the project of a renamed repository by its CI token and the confirmed name', async () => {
    const scm = {
      resolveRepository: jest.fn(async () => ({
        state: 'found',
        repository: coordinates('acme', 'api-2'),
      })),
    };
    const { identity } = make([project()], [], scm);

    await expect(
      identity.findRenamedByCiToken('acme/api-2', 'repository-secret'),
    ).resolves.toMatchObject({ id: 'project-1', scmFullName: 'acme/api-2' });
  });

  it("rejects a callback name the provider does not confirm for the token's project", async () => {
    const row = project();
    const scm = {
      resolveRepository: jest.fn(async () => ({
        state: 'found',
        repository: coordinates('acme', 'api-2'),
      })),
    };
    const { identity } = make([row], [], scm);

    await expect(
      identity.findRenamedByCiToken('acme/forged', 'repository-secret'),
    ).resolves.toBeNull();
  });

  it('does not ask the provider for a callback with an unknown token', async () => {
    const scm = { resolveRepository: jest.fn() };
    const { identity } = make([project()], [], scm);

    await expect(identity.findRenamedByCiToken('acme/api-2', 'other-secret')).resolves.toBeNull();
    await expect(identity.findRenamedByCiToken('acme/api-2', '')).resolves.toBeNull();
    expect(scm.resolveRepository).not.toHaveBeenCalled();
  });

  it('lets every project of a renamed account follow its installation', async () => {
    const renamed = project({ scmInstallation: { accountLogin: 'acme-labs', deletedAt: null } });
    const current = project({ id: 'project-2', name: 'web', scmRepositoryName: 'web' });
    const removed = project({
      id: 'project-3',
      name: 'old',
      scmInstallation: { accountLogin: 'gone', deletedAt: new Date() },
    });
    const scm = { resolveRepository: jest.fn() };
    const { identity } = make([renamed, current, removed], [], scm);

    await expect(identity.followRenamedInstallationAccounts()).resolves.toBe(1);

    expect(renamed).toMatchObject({
      name: 'api',
      scmOwner: 'acme-labs',
      scmFullName: 'acme-labs/api',
      repoUrl: 'https://github.com/acme-labs/api',
      deploymentKey: 'acme-api',
    });
    expect(current.scmOwner).toBe('acme');
    expect(removed.scmOwner).toBe('acme');
    // The signed webhook already confirmed the new login.
    expect(scm.resolveRepository).not.toHaveBeenCalled();
  });
});
