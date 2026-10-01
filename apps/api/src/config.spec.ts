import { config, validateConfig } from './config';

describe('validateConfig production secrets', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalArtifactStore = { ...config.artifactStore };
  const originalAgentDistribution = { ...config.agentDistribution };
  const originalUpdates = { ...config.updates };
  const originalGithub = { ...config.github };
  const originalCi = { ...config.ci };
  const originalEdition = config.edition;
  const originalSecrets = {
    jwtSecret: config.auth.jwtSecret,
    encryptionKey: config.security.encryptionKey,
    webhookToken: config.scm.webhookToken,
    oidcSecret: config.oidc.clientSecret,
    trustProxyHops: config.http.trustProxyHops,
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    config.auth.jwtSecret = 'test-jwt-secret';
    config.security.encryptionKey = 'test-encryption-key';
    config.scm.webhookToken = 'test-webhook-token';
    config.oidc.clientSecret = 'test-oidc-secret';
    Object.assign(config.artifactStore, {
      endpoint: 'http://minio:9000',
      bucket: 'artifacts',
      accessKeyId: 'initpad',
      secretAccessKey: 'secure-random-secret',
    });
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    config.auth.jwtSecret = originalSecrets.jwtSecret;
    config.security.encryptionKey = originalSecrets.encryptionKey;
    config.scm.webhookToken = originalSecrets.webhookToken;
    config.oidc.clientSecret = originalSecrets.oidcSecret;
    config.http.trustProxyHops = originalSecrets.trustProxyHops;
    Object.assign(config.artifactStore, originalArtifactStore);
    Object.assign(config.agentDistribution, originalAgentDistribution);
    Object.assign(config.updates, originalUpdates);
    Object.assign(config.github, originalGithub);
    Object.assign(config.ci, originalCi);
    config.edition = originalEdition;
  });

  it('rejects the Compose fallback artifact-store password', () => {
    config.artifactStore.secretAccessKey = 'initpad-artifacts';
    expect(() => validateConfig()).toThrow('INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY');
  });

  it('does not treat a non-secret access-key identifier as a password', () => {
    expect(() => validateConfig()).not.toThrow();
  });

  it.each([-1, 1.5, 6, Number.NaN])('rejects unsafe proxy hop configuration %s', (value) => {
    config.http.trustProxyHops = value;
    expect(() => validateConfig()).toThrow('INITPAD_TRUST_PROXY_HOPS');
  });

  it('accepts direct API topology with no trusted proxy', () => {
    config.http.trustProxyHops = 0;
    expect(() => validateConfig()).not.toThrow();
  });

  it('requires an immutable Agent image and its declared release version together', () => {
    config.agentDistribution.image = `ghcr.io/example/initpad-agent@sha256:${'a'.repeat(64)}`;
    config.agentDistribution.releaseVersion = '';
    expect(() => validateConfig()).toThrow('INITPAD_AGENT_IMAGE and INITPAD_AGENT_RELEASE_VERSION');

    config.agentDistribution.image = '';
    config.agentDistribution.releaseVersion = '0.11.0';
    expect(() => validateConfig()).toThrow('INITPAD_AGENT_IMAGE and INITPAD_AGENT_RELEASE_VERSION');
  });

  it('accepts a digest-bound Agent release with a stable declared version', () => {
    config.agentDistribution.image = `ghcr.io/example/initpad-agent@sha256:${'a'.repeat(64)}`;
    config.agentDistribution.releaseVersion = '0.11.0';
    expect(() => validateConfig()).not.toThrow();
  });

  it('rejects a prerelease-like Agent version in production distribution metadata', () => {
    config.agentDistribution.image = `ghcr.io/example/initpad-agent@sha256:${'a'.repeat(64)}`;
    config.agentDistribution.releaseVersion = '0.11.0-rc.1';
    expect(() => validateConfig()).toThrow('INITPAD_AGENT_RELEASE_VERSION');
  });

  it('accepts only the explicit stable and candidate Agent update channels', () => {
    config.updates.agentChannel = 'candidate';
    expect(() => validateConfig()).not.toThrow();

    config.updates.agentChannel = 'preview' as never;
    expect(() => validateConfig()).toThrow('INITPAD_AGENT_UPDATE_CHANNEL');
  });

  it('accepts only the explicit stable and candidate platform update channels', () => {
    config.updates.platformChannel = 'candidate';
    expect(() => validateConfig()).not.toThrow();

    config.updates.platformChannel = 'preview' as never;
    expect(() => validateConfig()).toThrow('INITPAD_PLATFORM_UPDATE_CHANNEL');
  });

  it('rejects an incomplete SaaS control plane configuration', () => {
    config.edition = 'saas';
    Object.assign(config.github, {
      appId: '',
      clientId: '',
      clientSecret: '',
      privateKey: '',
      webhookSecret: '',
      appSlug: '',
      callbackUrl: '',
    });
    config.ci.publicUrl = '';

    expect(() => validateConfig()).toThrow('SaaS edition requires INITPAD_GITHUB_APP_ID');
  });

  it('accepts a complete same-origin HTTPS SaaS configuration', () => {
    config.edition = 'saas';
    config.ci.publicUrl = 'https://initpad.example';
    Object.assign(config.github, {
      appId: '12345',
      clientId: 'Iv1.example',
      clientSecret: 'github-client-secret',
      privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      webhookSecret: 'w'.repeat(32),
      appSlug: 'initpad-example',
      callbackUrl: 'https://initpad.example/api/auth/github/callback',
    });

    expect(() => validateConfig()).not.toThrow();
  });

  it('rejects an HTTP or cross-origin GitHub callback in SaaS', () => {
    config.edition = 'saas';
    config.ci.publicUrl = 'https://initpad.example';
    Object.assign(config.github, {
      appId: '12345',
      clientId: 'Iv1.example',
      clientSecret: 'github-client-secret',
      privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      webhookSecret: 'w'.repeat(32),
      appSlug: 'initpad-example',
      callbackUrl: 'http://other.example/api/auth/github/callback',
    });

    expect(() => validateConfig()).toThrow('INITPAD_GITHUB_CALLBACK_URL');
  });
});
