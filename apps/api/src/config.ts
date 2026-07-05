import { resolve } from 'path';

export const config = {
  templatesDir:
    process.env.INITPAD_TEMPLATES_DIR || resolve(process.cwd(), '../../templates'),
  workspaceDir:
    process.env.INITPAD_WORKSPACE_DIR || resolve(process.cwd(), '../../.workspace'),
  gitea: {
    url: process.env.INITPAD_GITEA_URL || '',
    user: process.env.INITPAD_GITEA_USER || '',
    token: process.env.INITPAD_GITEA_TOKEN || '',
    // Gitea admin token — the platform uses it to provision user accounts
    // (managed registration). Falls back to the main token when not set.
    adminToken:
      process.env.INITPAD_GITEA_ADMIN_TOKEN || process.env.INITPAD_GITEA_TOKEN || '',
  },
  git: {
    authorName: process.env.INITPAD_GIT_AUTHOR_NAME || 'InitPad Bot',
    authorEmail: process.env.INITPAD_GIT_AUTHOR_EMAIL || 'bot@initpad.local',
  },
  auth: {
    clientId: process.env.INITPAD_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.INITPAD_OAUTH_CLIENT_SECRET || '',
    callbackUrl:
      process.env.INITPAD_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/auth/callback',
    frontendUrl: process.env.INITPAD_FRONTEND_URL || 'http://localhost:5173',
    jwtSecret: process.env.INITPAD_JWT_SECRET || 'dev-secret-zmen-me',
  },
  // Key for encrypting sensitive DB values (tokens). Falls back to the JWT secret.
  security: {
    encryptionKey:
      process.env.INITPAD_ENCRYPTION_KEY ||
      process.env.INITPAD_JWT_SECRET ||
      'dev-secret-zmen-me',
  },
  // CI → deploy: shared token the CI job uses to authenticate against the
  // platform webhook. The platform sets it as the repo's Actions secret.
  ci: {
    deployToken: process.env.INITPAD_CI_DEPLOY_TOKEN || 'ci-deploy-secret-change-me',
  },
  // Gitea container registry (OCI). The host must be reachable from the
  // host machine's Docker daemon (it performs both push and pull).
  // Credentials = the service (bot) account.
  registry: {
    host: process.env.INITPAD_REGISTRY_HOST || 'localhost:3001',
    user: process.env.INITPAD_GITEA_USER || '',
    password:
      process.env.INITPAD_GITEA_ADMIN_TOKEN || process.env.INITPAD_GITEA_TOKEN || '',
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
      publicUrl: process.env.INITPAD_SFTP_PUBLIC_URL || 'http://localhost:8085',
    },
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
  },
};

export const isAuthConfigured = (): boolean =>
  Boolean(config.auth.clientId && config.auth.clientSecret && config.gitea.url);
