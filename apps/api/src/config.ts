import { resolve } from 'path';
import { builtInPublicHost } from './common/public-url';

const configuredPublicUrl =
  process.env.INITPAD_FRONTEND_URL || process.env.INITPAD_PLATFORM_PUBLIC_URL;

// Built-in targets run on the InitPad host, so their browser-facing hostname
// follows the platform's public URL. This avoids two independent LAN addresses
// becoming inconsistent after changing a VM adapter/IP. A deliberately split
// topology can opt out through the explicitly named deployment-host override.
// INITPAD_PUBLIC_HOST remains only as a legacy fallback for npm-run-dev setups
// that do not configure a public platform URL.
const publicHost = builtInPublicHost(
  configuredPublicUrl,
  process.env.INITPAD_DEPLOY_PUBLIC_HOST,
  process.env.INITPAD_PUBLIC_HOST,
);

// Product edition (ADR-039). The self-hosted edition ships the embedded Gitea
// and the instance administrator chooses the registration policy below. The
// SaaS edition uses GitHub for identity and SCM; managed password registration
// stays disabled because GitHub is its only supported interactive login.
export type Edition = 'self-hosted' | 'saas';
const EDITIONS: readonly Edition[] = ['self-hosted', 'saas'];
const edition = (process.env.INITPAD_EDITION || 'self-hosted') as Edition;

// Registration policy for the self-hosted edition (ADR-040). Two modes: `open`
// is normal self-service registration (public deployment); `admin-provisioned`
// means only the instance admin creates accounts (private deployment). A
// brand-new instance always allows the very first account to bootstrap its
// administrator, regardless of the policy. Historical `invite-only`/`first-user`
// /`closed` values keep working as aliases for `admin-provisioned`.
export const REGISTRATION_MODES = ['open', 'admin-provisioned'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];
const LEGACY_REGISTRATION_ALIASES: Record<string, RegistrationMode> = {
  'invite-only': 'admin-provisioned',
  'first-user': 'admin-provisioned',
  closed: 'admin-provisioned',
};
const rawRegistrationMode = process.env.INITPAD_REGISTRATION_MODE || 'open';
function normalizeRegistrationMode(raw: string): RegistrationMode {
  if ((REGISTRATION_MODES as readonly string[]).includes(raw)) return raw as RegistrationMode;
  return LEGACY_REGISTRATION_ALIASES[raw] ?? 'open';
}

// Host the API itself uses to reach ports published on the Docker host
// (deployed-app health checks). Differs from publicHost when the API runs in
// a container: the compose setup sets it to 'host.docker.internal'.
const deployHealthHost = process.env.INITPAD_DEPLOY_HEALTH_HOST || publicHost;

export const config = {
  edition,
  publicHost,
  deployHealthHost,
  http: {
    // Number of reverse-proxy hops between a client and the API. Client IP is
    // a security input for rate limiting, so this must match the real topology
    // instead of trusting an arbitrary X-Forwarded-For chain.
    trustProxyHops: Number(process.env.INITPAD_TRUST_PROXY_HOPS ?? 1),
  },
  templatesDir: process.env.INITPAD_TEMPLATES_DIR || resolve(process.cwd(), '../../templates'),
  workspaceDir: process.env.INITPAD_WORKSPACE_DIR || resolve(process.cwd(), '../../.workspace'),
  agentDistribution: {
    // The control plane serves a generic installer, while the administrator
    // chooses the release image. Production images must be immutable: tags
    // alone could silently change the code granted access to Docker.
    image: (process.env.INITPAD_AGENT_IMAGE || '').trim(),
    installerPath:
      process.env.INITPAD_AGENT_INSTALLER_PATH ||
      resolve(process.cwd(), '../../apps/agent/install.sh'),
    packagePath:
      process.env.INITPAD_AGENT_PACKAGE_PATH ||
      resolve(process.cwd(), '../../apps/agent/package.json'),
  },
  gitea: {
    // Browser-facing URL (repository links shown to users, OAuth redirects).
    url: process.env.INITPAD_GITEA_URL || '',
    // Server-to-server URL the API uses for Gitea REST calls and git pushes.
    // Same as `url` in local development; the compose setup points it at the
    // internal service name (http://gitea:3000).
    internalUrl: process.env.INITPAD_GITEA_INTERNAL_URL || process.env.INITPAD_GITEA_URL || '',
    user: process.env.INITPAD_GITEA_USER || '',
    token: process.env.INITPAD_GITEA_TOKEN || '',
    // Gitea admin token — the platform uses it to provision user accounts
    // (managed registration). Falls back to the main token when not set.
    adminToken: process.env.INITPAD_GITEA_ADMIN_TOKEN || process.env.INITPAD_GITEA_TOKEN || '',
  },
  git: {
    authorName: process.env.INITPAD_GIT_AUTHOR_NAME || 'InitPad Bot',
    authorEmail: process.env.INITPAD_GIT_AUTHOR_EMAIL || 'bot@initpad.local',
  },
  auth: {
    frontendUrl: process.env.INITPAD_FRONTEND_URL || 'http://localhost:5173',
    jwtSecret: process.env.INITPAD_JWT_SECRET || 'dev-secret-zmen-me',
    registrationMode: normalizeRegistrationMode(rawRegistrationMode),
    secureCookie:
      process.env.INITPAD_COOKIE_SECURE === 'true' ||
      (process.env.INITPAD_COOKIE_SECURE !== 'false' &&
        (process.env.INITPAD_FRONTEND_URL || '').startsWith('https://')),
  },
  // Key for encrypting sensitive DB values (tokens). Falls back to the JWT secret.
  security: {
    encryptionKey:
      process.env.INITPAD_ENCRYPTION_KEY || process.env.INITPAD_JWT_SECRET || 'dev-secret-zmen-me',
  },
  // CI → deploy: shared token the CI job uses to authenticate against the
  // platform webhook. The platform sets it as the repo's Actions secret.
  ci: {
    // Platform API base URL as reachable FROM CI job containers. Written to
    // each repo as an Actions secret; the generated workflow posts the deploy
    // webhook to it. host.docker.internal works for the npm-run-dev setup;
    // the compose setup overrides it with the internal service name.
    platformUrl: process.env.INITPAD_PLATFORM_INTERNAL_URL || 'http://host.docker.internal:3000',
    // Public browser/API origin reachable by GitHub-hosted Actions runners.
    // Kept separate from the internal Gitea callback above: localhost and
    // Docker service names are valid internally but never from github.com.
    publicUrl: process.env.INITPAD_PLATFORM_PUBLIC_URL || process.env.INITPAD_FRONTEND_URL || '',
  },
  scm: {
    webhookUrl:
      process.env.INITPAD_SCM_WEBHOOK_URL ||
      process.env.INITPAD_PLATFORM_INTERNAL_URL ||
      'http://host.docker.internal:3000',
    webhookToken:
      process.env.INITPAD_SCM_WEBHOOK_TOKEN ||
      process.env.INITPAD_CI_DEPLOY_TOKEN ||
      'scm-webhook-secret-change-me',
  },
  // Gitea container registry (OCI). The host must be reachable from the
  // host machine's Docker daemon (it performs both push and pull).
  // Credentials = the service (bot) account.
  registry: {
    host: process.env.INITPAD_REGISTRY_HOST || '127.0.0.1:3001',
    // Same registry, but addressed from glibc-based CI job containers and
    // their nested daemon (where *.localhost resolves to loopback).
    ciHost: process.env.INITPAD_CI_REGISTRY_HOST || 'host.docker.internal:3001',
    user: process.env.INITPAD_GITEA_USER || '',
    password: process.env.INITPAD_GITEA_ADMIN_TOKEN || process.env.INITPAD_GITEA_TOKEN || '',
  },
  deployment: {
    // Development binds app ports to loopback. A server installation opts in
    // to public binding explicitly (or can put an ingress in front instead).
    bindAddress: process.env.INITPAD_DEPLOY_BIND_ADDRESS || '127.0.0.1',
    memoryBytes: Number(process.env.INITPAD_DEPLOY_MEMORY_MB || 512) * 1024 * 1024,
    nanoCpus: Number(process.env.INITPAD_DEPLOY_CPU || 1) * 1_000_000_000,
    pidsLimit: Number(process.env.INITPAD_DEPLOY_PIDS_LIMIT || 256),
  },
  // Non-Docker deployment targets (simulated company infrastructure). Must
  // match infra/docker-compose.yml (published ports of fake-vps / fake-sftp
  // / nginx).
  providers: {
    // Runtime apps over SSH → the fake-vps container (sshd + Node).
    ssh: {
      host: process.env.INITPAD_SSH_HOST || 'localhost',
      port: Number(process.env.INITPAD_SSH_PORT || 2200),
      username: process.env.INITPAD_SSH_USER || 'deploy',
      password: process.env.INITPAD_SSH_PASSWORD || 'deploy',
      // Root for release directories on the remote host (the SSH user's home).
      remoteRoot: process.env.INITPAD_SSH_REMOTE_ROOT || '/config/deploys',
      // Host port range mapped 1:1 onto fake-vps. Ports are allocated from
      // this range in the database (Environment.allocatedPort), so every SSH
      // deployment gets a unique port. Must match the range published in
      // infra/docker-compose.yml.
      appPortBase: Number(process.env.INITPAD_SSH_APP_PORT_BASE || 8090),
      appPortSlots: Number(process.env.INITPAD_SSH_APP_PORT_SLOTS || 100),
    },
    // Static/PHP apps over SFTP → the fake-sftp container; served by nginx.
    sftp: {
      host: process.env.INITPAD_SFTP_HOST || 'localhost',
      port: Number(process.env.INITPAD_SFTP_PORT || 2222),
      username: process.env.INITPAD_SFTP_USER || 'deploy',
      password: process.env.INITPAD_SFTP_PASSWORD || 'deploy',
      // Writable root inside the SFTP user's chroot (atmoz: /<dir>).
      remoteRoot: process.env.INITPAD_SFTP_REMOTE_ROOT || '/www',
      // Subdirectory with the static build, when the template produces one (otherwise the whole repo).
      artifactSubdir: process.env.INITPAD_SFTP_ARTIFACT_DIR || '',
      // Public address where nginx serves the published releases.
      publicUrl: process.env.INITPAD_SFTP_PUBLIC_URL || `http://${publicHost}:8085`,
      // Address the API uses to verify the site is being served (reachable
      // from wherever the API runs; compose points it at http://static-web).
      internalUrl:
        process.env.INITPAD_SFTP_INTERNAL_URL ||
        process.env.INITPAD_SFTP_PUBLIC_URL ||
        `http://${deployHealthHost}:8085`,
    },
  },
  // GitHub App for the hosted edition (ADR-030). One App provides two bindings:
  // OAuth user authorization (Sign in with / link GitHub) and app installation
  // (repository access via short-lived installation tokens). All values are
  // optional: when unset the GitHub adapter stays inert and never blocks the
  // Gitea path.
  github: {
    appId: process.env.INITPAD_GITHUB_APP_ID || '',
    // OAuth user-authorization credentials (identity linking / sign-in).
    clientId: process.env.INITPAD_GITHUB_CLIENT_ID || '',
    clientSecret: process.env.INITPAD_GITHUB_CLIENT_SECRET || '',
    // App private key (PEM). Env vars often carry it as a single line with
    // escaped newlines, so unescape them here.
    privateKey: (process.env.INITPAD_GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    webhookSecret: process.env.INITPAD_GITHUB_WEBHOOK_SECRET || '',
    // Public App slug, used to build the "Install GitHub App" link.
    appSlug: process.env.INITPAD_GITHUB_APP_SLUG || '',
    apiBaseUrl: process.env.INITPAD_GITHUB_API_URL || 'https://api.github.com',
    // Base for the OAuth authorize/token endpoints (github.com; overridable for
    // GitHub Enterprise). The callback must match the App's configured URL.
    oauthBaseUrl: process.env.INITPAD_GITHUB_OAUTH_URL || 'https://github.com',
    callbackUrl: process.env.INITPAD_GITHUB_CALLBACK_URL || '',
  },
  // Durable object storage for verified build artifacts (ADR-059). An S3-compatible
  // private bucket: MinIO locally, S3 (or compatible) in the cloud. This is the
  // source of truth for a built image; the local Docker daemon is only a warm cache
  // rehydrated from here. Never a public bucket; credentials never logged. When the
  // bucket/credentials are unset the store is "unconfigured": self-hosted may fall
  // back to the Docker-daemon-only path, but the SaaS edition refuses to start.
  artifactStore: {
    endpoint: process.env.INITPAD_ARTIFACT_S3_ENDPOINT || '',
    region: process.env.INITPAD_ARTIFACT_S3_REGION || 'us-east-1',
    bucket: process.env.INITPAD_ARTIFACT_S3_BUCKET || '',
    accessKeyId: process.env.INITPAD_ARTIFACT_S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY || '',
    // MinIO and other non-AWS S3 servers need path-style addressing.
    forcePathStyle: (process.env.INITPAD_ARTIFACT_S3_FORCE_PATH_STYLE || 'true') !== 'false',
    // Lifetime of a job-scoped presigned download link handed to the Agent (seconds).
    presignTtlSeconds: Number(process.env.INITPAD_ARTIFACT_PRESIGN_TTL_SECONDS || 300),
    // Verified artifacts older than this are eligible for GC unless still referenced.
    retentionDays: Number(process.env.INITPAD_ARTIFACT_RETENTION_DAYS || 30),
  },
  // The platform as an OIDC provider (SSO into Gitea); Gitea registers as a
  // client. issuer = address the Gitea SERVER calls (from its container via
  // host.docker.internal). publicUrl = address for the BROWSER (authorize
  // redirect).
  oidc: {
    issuer: process.env.INITPAD_OIDC_ISSUER || 'http://host.docker.internal:3000/api',
    publicUrl: process.env.INITPAD_OIDC_PUBLIC_URL || 'http://localhost:3000/api',
    clientId: process.env.INITPAD_OIDC_CLIENT_ID || 'gitea',
    clientSecret: process.env.INITPAD_OIDC_CLIENT_SECRET || 'gitea-oidc-secret-change-me',
    // Path to the RSA signing key (PEM). When set, the key is loaded from —
    // or generated into — this file, so SSO sessions survive API restarts.
    // When empty, an in-memory key is generated (dev mode).
    keyFile: process.env.INITPAD_OIDC_KEY_FILE || '',
  },
};

// True when the object store has enough configuration to be used. Requires a
// bucket plus credentials; endpoint may be empty for real AWS S3 (SDK default).
export function artifactStoreConfigured(): boolean {
  const s = config.artifactStore;
  return Boolean(s.bucket && s.accessKeyId && s.secretAccessKey);
}

export function validateConfig(): void {
  if (!EDITIONS.includes(config.edition)) {
    throw new Error(
      `INITPAD_EDITION must be one of ${EDITIONS.join(', ')} (received '${config.edition}')`,
    );
  }
  if (
    !Number.isInteger(config.http.trustProxyHops) ||
    config.http.trustProxyHops < 0 ||
    config.http.trustProxyHops > 5
  ) {
    throw new Error('INITPAD_TRUST_PROXY_HOPS must be an integer between 0 and 5');
  }
  const acceptedModes = [...REGISTRATION_MODES, ...Object.keys(LEGACY_REGISTRATION_ALIASES)];
  if (!acceptedModes.includes(rawRegistrationMode)) {
    throw new Error(
      `INITPAD_REGISTRATION_MODE must be one of ${acceptedModes.join(', ')} (received '${rawRegistrationMode}')`,
    );
  }
  const { presignTtlSeconds, retentionDays } = config.artifactStore;
  if (!Number.isFinite(presignTtlSeconds) || presignTtlSeconds < 30 || presignTtlSeconds > 3600) {
    throw new Error('INITPAD_ARTIFACT_PRESIGN_TTL_SECONDS must be between 30 and 3600');
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error('INITPAD_ARTIFACT_RETENTION_DAYS must be a positive number of days');
  }
  // The SaaS control plane has no single-host Docker daemon to fall back on, so a
  // durable artifact store is mandatory there — fail loudly rather than silently
  // losing builds on restart.
  if (config.edition === 'saas' && !artifactStoreConfigured()) {
    throw new Error(
      'SaaS edition requires a durable artifact store: set INITPAD_ARTIFACT_S3_BUCKET, ' +
        'INITPAD_ARTIFACT_S3_ACCESS_KEY_ID and INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY',
    );
  }
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(config.deployment.bindAddress)) {
    throw new Error('INITPAD_DEPLOY_BIND_ADDRESS must be a local or wildcard IP address');
  }
  if (
    config.agentDistribution.image &&
    !/^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(config.agentDistribution.image)
  ) {
    throw new Error(
      'INITPAD_AGENT_IMAGE must be an immutable OCI reference ending in @sha256:<64 lowercase hex characters>',
    );
  }
  if (
    !Number.isFinite(config.deployment.memoryBytes) ||
    config.deployment.memoryBytes < 64 * 1024 * 1024 ||
    !Number.isFinite(config.deployment.nanoCpus) ||
    config.deployment.nanoCpus <= 0 ||
    !Number.isInteger(config.deployment.pidsLimit) ||
    config.deployment.pidsLimit < 32
  ) {
    throw new Error('Deployment resource limits are invalid');
  }
  if (process.env.NODE_ENV !== 'production') return;
  const insecure: string[] = [];
  if (config.auth.jwtSecret === 'dev-secret-zmen-me') insecure.push('INITPAD_JWT_SECRET');
  if (config.security.encryptionKey === 'dev-secret-zmen-me')
    insecure.push('INITPAD_ENCRYPTION_KEY');
  if (config.scm.webhookToken === 'scm-webhook-secret-change-me') {
    insecure.push('INITPAD_SCM_WEBHOOK_TOKEN');
  }
  if (config.oidc.clientSecret === 'gitea-oidc-secret-change-me') {
    insecure.push('INITPAD_OIDC_CLIENT_SECRET');
  }
  if (artifactStoreConfigured() && config.artifactStore.secretAccessKey === 'initpad-artifacts') {
    insecure.push('INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY');
  }
  if (insecure.length) {
    throw new Error(`Refusing production startup with insecure defaults: ${insecure.join(', ')}`);
  }
}
