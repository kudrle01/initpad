import { config, validateConfig } from './config';

describe('validateConfig production secrets', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalArtifactStore = { ...config.artifactStore };
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
});
