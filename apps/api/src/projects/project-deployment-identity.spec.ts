import {
  artifactImageRef,
  deployedImageRef,
  deploymentSlug,
  imageRepository,
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
    expect(
      artifactImageRef(github, { commitSha: 'a'.repeat(40), providerRunId: 'run-17' }),
    ).toBe(`ghcr.io/acme-team/customer-api:${'a'.repeat(40)}-run-17`);
  });

  it('does not invent a GitHub image ref without verified artifact identity', () => {
    expect(deployedImageRef(github, { version: 'a'.repeat(40), buildArtifact: null })).toBeUndefined();
    expect(deployedImageRef(github, { version: 'bootstrap', buildArtifact: null })).toBeUndefined();
  });
});
