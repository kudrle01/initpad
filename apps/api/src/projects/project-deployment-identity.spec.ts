import {
  artifactImageRef,
  deployedImageRef,
  deploymentSlug,
  imageRepository,
  storedArtifactImageRef,
  workloadKey,
} from './project-deployment-identity';

describe('project deployment identity', () => {
  const github = {
    provider: 'github',
    owner: 'Acme-Team',
    name: 'customer-api',
    fullName: 'Acme-Team/customer-api',
    repositoryId: '101',
    defaultBranch: 'main',
    repoUrl: 'https://github.com/Acme-Team/customer-api',
    installationId: 'installation-1',
  } as const;

  it('creates a Docker-safe owner-namespaced workload key', () => {
    expect(deploymentSlug(github)).toBe('acme-team-customer-api');
  });

  it('uses GHCR and binds GitHub images to the exact workflow run', () => {
    expect(imageRepository(github)).toBe('ghcr.io/acme-team/customer-api');
    expect(artifactImageRef(github, { commitSha: 'a'.repeat(40), providerRunId: 'run-17' })).toBe(
      `ghcr.io/acme-team/customer-api:${'a'.repeat(40)}-run-17`,
    );
  });

  const row = {
    scmProvider: 'github',
    scmRepositoryId: '101',
    scmOwner: 'Acme-Team',
    scmRepositoryName: 'renamed-api',
    scmFullName: 'Acme-Team/renamed-api',
    scmDefaultBranch: 'main',
    scmInstallationId: 'installation-1',
    repoUrl: 'https://github.com/Acme-Team/renamed-api',
  };

  it('keeps the stored workload key after the repository is renamed', () => {
    expect(workloadKey({ ...row, deploymentKey: 'acme-team-customer-api' })).toBe(
      'acme-team-customer-api',
    );
  });

  it('derives the key of a row written before it was stored', () => {
    expect(workloadKey({ ...row, deploymentKey: null })).toBe('acme-team-renamed-api');
    expect(workloadKey(row)).toBe('acme-team-renamed-api');
  });

  it('prefers the image reference stored with a build over the current coordinates', () => {
    const renamed = { ...github, name: 'renamed-api', fullName: 'Acme-Team/renamed-api' };
    const build = { commitSha: 'a'.repeat(40), providerRunId: 'run-17' };
    const stored = `ghcr.io/acme-team/customer-api:${'a'.repeat(40)}-run-17`;

    expect(storedArtifactImageRef(renamed, { ...build, imageRef: stored })).toBe(stored);
    expect(storedArtifactImageRef(renamed, { ...build, imageRef: null })).toBe(
      `ghcr.io/acme-team/renamed-api:${'a'.repeat(40)}-run-17`,
    );
    expect(
      deployedImageRef(renamed, {
        version: 'a'.repeat(40),
        buildArtifact: { ...build, imageRef: stored },
      }),
    ).toBe(stored);
  });

  it('does not invent a GitHub image ref without verified artifact identity', () => {
    expect(
      deployedImageRef(github, { version: 'a'.repeat(40), buildArtifact: null }),
    ).toBeUndefined();
    expect(deployedImageRef(github, { version: 'bootstrap', buildArtifact: null })).toBeUndefined();
  });
});
