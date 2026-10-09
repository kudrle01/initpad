import { builtInAppsShareSessionCookie, config, validateConfig } from './config';

describe('validateConfig production secrets', () => {
  const fakePrivateKey = [
    '-----BEGIN',
    'PRIVATE KEY-----\ntest-fixture-only\n-----END PRIVATE KEY-----',
  ].join(' ');
  const originalNodeEnv = process.env.NODE_ENV;
  const originalArtifactStore = { ...config.artifactStore };
  const originalAgentDistribution = { ...config.agentDistribution };
  const originalUpdates = { ...config.updates };
  const originalGithub = { ...config.github };
  const originalCi = { ...config.ci };
  const originalMail = { ...config.mail };
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
    config.auth.jwtSecret = 'test-jwt-secret-0123456789abcdef0123';
    config.security.encryptionKey = 'test-encryption-key-0123456789abcdef';
    config.security.previousEncryptionKeys = [];
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
    config.security.previousEncryptionKeys = [];
    config.scm.webhookToken = originalSecrets.webhookToken;
    config.oidc.clientSecret = originalSecrets.oidcSecret;
    config.http.trustProxyHops = originalSecrets.trustProxyHops;
    Object.assign(config.artifactStore, originalArtifactStore);
    Object.assign(config.agentDistribution, originalAgentDistribution);
    Object.assign(config.updates, originalUpdates);
    Object.assign(config.github, originalGithub);
    Object.assign(config.ci, originalCi);
    Object.assign(config.mail, originalMail);
    config.edition = originalEdition;
  });

  it('requires an explicit encryption key separate from the JWT secret (ADR-141)', () => {
    config.security.encryptionKey = 'dev-secret-zmen-me';
    expect(() => validateConfig()).toThrow('without INITPAD_ENCRYPTION_KEY');

    config.security.encryptionKey = config.auth.jwtSecret;
    expect(() => validateConfig()).toThrow('INITPAD_ENCRYPTION_KEY and INITPAD_JWT_SECRET');
  });

  it('rejects short or placeholder signing and encryption keys', () => {
    config.auth.jwtSecret = 'short-jwt-secret';
    expect(() => validateConfig()).toThrow('INITPAD_JWT_SECRET');

    config.auth.jwtSecret = 'test-jwt-secret-0123456789abcdef0123';
    config.security.encryptionKey = 'zmen-me-na-nahodny-retezec-0123456789';
    expect(() => validateConfig()).toThrow('INITPAD_ENCRYPTION_KEY');

    config.security.encryptionKey = 'test-encryption-key-0123456789abcdef';
    config.security.previousEncryptionKeys = ['too-short'];
    expect(() => validateConfig()).toThrow('INITPAD_ENCRYPTION_KEY_PREVIOUS');

    config.security.previousEncryptionKeys = [];
    config.scm.webhookToken = '__GENERATE__';
    expect(() => validateConfig()).toThrow('INITPAD_SCM_WEBHOOK_TOKEN');
  });

  it('validates shared-network rate-limit ranges and their factor (ADR-149)', () => {
    const saved = { ...config.rateLimit };
    try {
      config.rateLimit.sharedNetworks = ['198.51.100.0/24'];
      expect(() => validateConfig()).not.toThrow();
      config.rateLimit.sharedNetworks = ['198.51.100.0'];
      expect(() => validateConfig()).toThrow('invalid CIDR range');
      config.rateLimit.sharedNetworks = [];
      config.rateLimit.sharedNetworkFactor = 0;
      expect(() => validateConfig()).toThrow('INITPAD_RATE_LIMIT_SHARED_NETWORK_FACTOR');
    } finally {
      Object.assign(config.rateLimit, saved);
    }
  });

  it('refuses the in-memory artifact store in production (ADR-146)', () => {
    config.artifactStore.bucket = '';
    expect(() => validateConfig()).toThrow('Production requires a durable artifact store');
  });

  it('rejects the Compose fallback artifact-store password', () => {
    config.artifactStore.secretAccessKey = 'initpad-artifacts';
    expect(() => validateConfig()).toThrow('INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY');
  });

  it('does not treat a non-secret access-key identifier as a password', () => {
    expect(() => validateConfig()).not.toThrow();
  });

  it('rejects partial SMTP configuration and accepts a complete TLS relay', () => {
    Object.assign(config.mail, { host: 'smtp.example', from: '', username: '', password: '' });
    expect(() => validateConfig()).toThrow('INITPAD_SMTP_HOST and INITPAD_SMTP_FROM');

    Object.assign(config.mail, {
      host: 'smtp.example',
      port: 587,
      secure: false,
      requireTls: true,
      username: 'initpad',
      password: 'smtp-secret',
      from: 'InitPad <no-reply@initpad.example>',
    });
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
    config.http.trustProxyHops = 2;
    config.ci.publicUrl = 'https://initpad.example';
    Object.assign(config.github, {
      appId: '12345',
      clientId: 'Iv1.example',
      clientSecret: 'github-client-secret',
      privateKey: fakePrivateKey,
      webhookSecret: 'w'.repeat(32),
      appSlug: 'initpad-example',
      callbackUrl: 'https://initpad.example/api/auth/github/callback',
    });
    Object.assign(config.mail, {
      host: 'smtp.example',
      port: 587,
      secure: false,
      requireTls: true,
      username: 'initpad',
      password: 'smtp-secret',
      from: 'InitPad <no-reply@initpad.example>',
    });

    expect(() => validateConfig()).not.toThrow();
    // SaaS has no Gitea: the OIDC and Gitea webhook secrets are not needed
    // (ADR-153), while a self-hosted instance must still set them.
    config.scm.webhookToken = 'scm-webhook-secret-change-me';
    config.oidc.clientSecret = 'gitea-oidc-secret-change-me';
    expect(() => validateConfig()).not.toThrow();
    config.edition = 'self-hosted';
    config.http.trustProxyHops = 1;
    expect(() => validateConfig()).toThrow('INITPAD_SCM_WEBHOOK_TOKEN, INITPAD_OIDC_CLIENT_SECRET');
  });

  it('rejects an HTTP or cross-origin GitHub callback in SaaS', () => {
    config.edition = 'saas';
    config.http.trustProxyHops = 2;
    config.ci.publicUrl = 'https://initpad.example';
    Object.assign(config.github, {
      appId: '12345',
      clientId: 'Iv1.example',
      clientSecret: 'github-client-secret',
      privateKey: fakePrivateKey,
      webhookSecret: 'w'.repeat(32),
      appSlug: 'initpad-example',
      callbackUrl: 'http://other.example/api/auth/github/callback',
    });
    Object.assign(config.mail, {
      host: 'smtp.example',
      port: 587,
      secure: false,
      requireTls: true,
      username: 'initpad',
      password: 'smtp-secret',
      from: 'InitPad <no-reply@initpad.example>',
    });

    expect(() => validateConfig()).toThrow('INITPAD_GITHUB_CALLBACK_URL');
  });

  it('rejects a SaaS proxy path that does not match edge -> web -> API', () => {
    config.edition = 'saas';
    config.http.trustProxyHops = 1;
    config.ci.publicUrl = 'https://initpad.example';
    Object.assign(config.github, {
      appId: '12345',
      clientId: 'Iv1.example',
      clientSecret: 'github-client-secret',
      privateKey: fakePrivateKey,
      webhookSecret: 'w'.repeat(32),
      appSlug: 'initpad-example',
      callbackUrl: 'https://initpad.example/api/auth/github/callback',
    });
    Object.assign(config.mail, {
      host: 'smtp.example',
      port: 587,
      secure: false,
      requireTls: true,
      username: 'initpad',
      password: 'smtp-secret',
      from: 'InitPad <no-reply@initpad.example>',
    });

    expect(() => validateConfig()).toThrow('INITPAD_TRUST_PROXY_HOPS=2');
  });

  it('rejects a guessable first-administrator setup token', () => {
    const original = config.auth.bootstrapToken;
    try {
      config.auth.bootstrapToken = 'short-token';
      expect(() => validateConfig()).toThrow(
        'INITPAD_BOOTSTRAP_TOKEN must contain at least 32 characters',
      );
      config.auth.bootstrapToken = 'b'.repeat(48);
      expect(() => validateConfig()).not.toThrow();
    } finally {
      config.auth.bootstrapToken = original;
    }
  });

  it('defaults self-hosted registration to administrator-provisioned accounts', () => {
    // Unset in this test environment, so the module default applies (ADR-136).
    expect(process.env.INITPAD_REGISTRATION_MODE).toBeUndefined();
    expect(config.auth.registrationMode).toBe('admin-provisioned');
  });

  it('flags built-in applications that share the InitPad host over HTTP (ADR-137)', () => {
    const original = {
      edition: config.edition,
      secureCookie: config.auth.secureCookie,
      frontendUrl: config.auth.frontendUrl,
      publicHost: config.publicHost,
    };
    try {
      config.edition = 'self-hosted';
      config.auth.secureCookie = false;
      config.auth.frontendUrl = 'http://192.168.1.20:8080';
      config.publicHost = '192.168.1.20';
      expect(builtInAppsShareSessionCookie()).toBe(true);

      config.publicHost = 'apps.school.test';
      expect(builtInAppsShareSessionCookie()).toBe(false);

      config.publicHost = '192.168.1.20';
      config.auth.secureCookie = true;
      expect(builtInAppsShareSessionCookie()).toBe(false);
    } finally {
      config.edition = original.edition;
      config.auth.secureCookie = original.secureCookie;
      config.auth.frontendUrl = original.frontendUrl;
      config.publicHost = original.publicHost;
    }
  });
});
