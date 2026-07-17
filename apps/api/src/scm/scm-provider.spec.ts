import { repositoryRef } from './scm-provider';

describe('repositoryRef', () => {
  it('uses explicit SCM fields and never parses mutable repository URLs', () => {
    expect(
      repositoryRef({
        scmProvider: 'github',
        scmRepositoryId: '987',
        scmOwner: 'acme',
        scmRepositoryName: 'renamed-api',
        scmFullName: 'acme/renamed-api',
        scmDefaultBranch: 'trunk',
        scmInstallationId: 'installation-row-1',
        repoUrl: 'https://example.invalid/stale/value',
      }),
    ).toEqual({
      provider: 'github',
      repositoryId: '987',
      owner: 'acme',
      name: 'renamed-api',
      fullName: 'acme/renamed-api',
      defaultBranch: 'trunk',
      installationId: 'installation-row-1',
      repoUrl: 'https://example.invalid/stale/value',
    });
  });

  it('rejects an unknown provider instead of silently routing it to Gitea', () => {
    expect(() =>
      repositoryRef({
        scmProvider: 'unknown',
        scmRepositoryId: null,
        scmOwner: 'acme',
        scmRepositoryName: 'api',
        scmFullName: 'acme/api',
        scmDefaultBranch: 'main',
        scmInstallationId: null,
        repoUrl: null,
      }),
    ).toThrow("Unsupported SCM provider 'unknown'");
  });
});
