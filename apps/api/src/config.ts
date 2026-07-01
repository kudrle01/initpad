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
    // Token Gitea admina – platforma jím zakládá uživatelské účty (řízená
    // registrace). Když není zvlášť, použije se hlavní token.
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
  // Klíč pro šifrování citlivých hodnot v DB (tokeny). Fallback na JWT secret.
  security: {
    encryptionKey:
      process.env.INITPAD_ENCRYPTION_KEY ||
      process.env.INITPAD_JWT_SECRET ||
      'dev-secret-zmen-me',
  },
  // Platforma jako OIDC provider (SSO do Gitey). Gitea se registruje jako klient.
  // issuer = adresa, na kterou chodí Gitea SERVER (z kontejneru přes
  // host.docker.internal). publicUrl = adresa pro PROHLÍŽEČ (authorize redirect).
  oidc: {
    issuer: process.env.INITPAD_OIDC_ISSUER || 'http://host.docker.internal:3000/api',
    publicUrl: process.env.INITPAD_OIDC_PUBLIC_URL || 'http://localhost:3000/api',
    clientId: process.env.INITPAD_OIDC_CLIENT_ID || 'gitea',
    clientSecret: process.env.INITPAD_OIDC_CLIENT_SECRET || 'gitea-oidc-secret-change-me',
  },
};

export const isAuthConfigured = (): boolean =>
  Boolean(config.auth.clientId && config.auth.clientSecret && config.gitea.url);
