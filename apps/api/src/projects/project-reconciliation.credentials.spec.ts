import { ProjectReconciliation } from './project-reconciliation';
import { ScmHttpStatusError } from '../scm/scm-http';
import { hashToken } from '../common/token';

function project(id: string, ciDeployTokenHash: string | null) {
  return {
    id,
    ciDeployTokenHash,
    scmProvider: 'gitea',
    scmRepositoryId: id.replace('project-', ''),
    scmOwner: 'alice',
    scmRepositoryName: id,
    scmFullName: `alice/${id}`,
    scmDefaultBranch: 'main',
    scmInstallationId: null,
    repoUrl: `http://gitea.test/alice/${id}`,
  };
}

function harness(projects: ReturnType<typeof project>[], scm: Record<string, jest.Mock>) {
  const calls: string[] = [];
  const record =
    (name: string, implementation: (...args: never[]) => unknown = () => undefined) =>
    async (...args: never[]) => {
      calls.push(name);
      return implementation(...args);
    };
  const provider = {
    rotateRegistryCredential: jest.fn(record('rotate')),
    configureRepoSecrets: jest.fn(record('configure')),
    issueCloneToken: jest.fn(record('clone', () => 'scoped-clone-token')),
    revokeLegacyCredentials: jest.fn(record('revoke-legacy')),
    ...scm,
  };
  const prisma = {
    user: {
      findMany: jest.fn(async () => [{ id: 'u1', username: 'alice' }]),
      update: jest.fn(record('mark-user')),
    },
    project: {
      findMany: jest.fn(async () => projects),
      update: jest.fn(record('store-deploy-token')),
    },
  };
  const reconciliation = new ProjectReconciliation(
    prisma as never,
    {} as never,
    { provider: jest.fn(() => provider) } as never,
    {} as never,
    () => ({ username: 'alice', token: '' }),
    jest.fn(),
  );
  return { reconciliation, provider, prisma, calls };
}

describe('ProjectReconciliation scoped Gitea credentials (ADR-134)', () => {
  it('moves every repository off legacy tokens before revoking them', async () => {
    const { reconciliation, provider, prisma, calls } = harness(
      [project('project-1', 'hash'), project('project-2', null)],
      {},
    );

    await reconciliation.reconcileGiteaCredentials();

    expect(calls).toEqual([
      'rotate',
      'configure',
      'store-deploy-token',
      'clone',
      'revoke-legacy',
      'mark-user',
    ]);
    expect(provider.rotateRegistryCredential).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'alice/project-1' }),
    );
    // A project older than repository-specific CI credentials gets its own.
    const deployToken = provider.configureRepoSecrets.mock.calls[0][1] as string;
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-2' },
      data: { ciDeployTokenHash: hashToken(deployToken) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        accessToken: expect.stringMatching(/^enc:v1:/),
        giteaCredentialsScopedAt: expect.any(Date),
      },
    });
  });

  it('keeps legacy tokens and retries later when a repository cannot be migrated', async () => {
    const { reconciliation, provider, prisma } = harness([project('project-1', 'hash')], {
      rotateRegistryCredential: jest.fn(async () => {
        throw new ScmHttpStatusError('Gitea', 'configure Actions secret', 503);
      }),
    });

    await reconciliation.reconcileGiteaCredentials();

    expect(provider.revokeLegacyCredentials).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('skips a repository deleted outside InitPad', async () => {
    const { reconciliation, provider, prisma } = harness([project('project-1', 'hash')], {
      rotateRegistryCredential: jest.fn(async () => {
        throw new ScmHttpStatusError('Gitea', 'configure Actions secret', 404);
      }),
    });

    await reconciliation.reconcileGiteaCredentials();

    expect(provider.revokeLegacyCredentials).toHaveBeenCalledWith('alice');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('does nothing once every account is scoped', async () => {
    const { reconciliation, provider, prisma } = harness([], {});
    prisma.user.findMany.mockResolvedValueOnce([]);

    await reconciliation.reconcileGiteaCredentials();

    expect(provider.issueCloneToken).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });
});
