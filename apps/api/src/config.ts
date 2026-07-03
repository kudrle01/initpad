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
  // CI → deploy: sdílený token, kterým se CI job autentizuje proti webhooku
  // platformy. Platforma ho nastaví jako Actions secret repa (musí sedět).
  ci: {
    deployToken: process.env.INITPAD_CI_DEPLOY_TOKEN || 'ci-deploy-secret-change-me',
  },
  // Gitea container registry (OCI). Host musí být dosažitelný z hostitelského
  // Docker daemonu (ten dělá push i pull). Přihlášení = bot účet.
  registry: {
    host: process.env.INITPAD_REGISTRY_HOST || 'localhost:3001',
    user: process.env.INITPAD_GITEA_USER || '',
    password:
      process.env.INITPAD_GITEA_ADMIN_TOKEN || process.env.INITPAD_GITEA_TOKEN || '',
  },
  // Cíle nasazení mimo Docker (simulace firemní infrastruktury). Musí sedět
  // s infra/docker-compose.yml (publikované porty fake-vps / fake-sftp / nginx).
  providers: {
    // Runtime app přes SSH → kontejner fake-vps (sshd + Node).
    ssh: {
      host: process.env.INITPAD_SSH_HOST || 'localhost',
      port: Number(process.env.INITPAD_SSH_PORT || 2200),
      username: process.env.INITPAD_SSH_USER || 'deploy',
      password: process.env.INITPAD_SSH_PASSWORD || 'deploy',
      // Kořen pro release adresáře na vzdáleném hostu (domov ssh uživatele).
      remoteRoot: process.env.INITPAD_SSH_REMOTE_ROOT || '/config/deploys',
      // Rozsah host portů namapovaných 1:1 na fake-vps. App poslouchá na
      // <appPortBase + slot> a stejný port je publikovaný na host → funkční URL.
      appPortBase: Number(process.env.INITPAD_SSH_APP_PORT_BASE || 8090),
      appPortSlots: Number(process.env.INITPAD_SSH_APP_PORT_SLOTS || 10),
    },
    // Statická/PHP aplikace přes SFTP → kontejner fake-sftp; servíruje nginx.
    sftp: {
      host: process.env.INITPAD_SFTP_HOST || 'localhost',
      port: Number(process.env.INITPAD_SFTP_PORT || 2222),
      username: process.env.INITPAD_SFTP_USER || 'deploy',
      password: process.env.INITPAD_SFTP_PASSWORD || 'deploy',
      // Zapisovatelný kořen v chrootu SFTP uživatele (atmoz: /<dir>).
      remoteRoot: process.env.INITPAD_SFTP_REMOTE_ROOT || '/www',
      // Podadresář se statickým buildem, pokud ho šablona produkuje (jinak celý repo).
      artifactSubdir: process.env.INITPAD_SFTP_ARTIFACT_DIR || '',
      // Veřejná adresa, na které nginx servíruje symlink `current`.
      publicUrl: process.env.INITPAD_SFTP_PUBLIC_URL || 'http://localhost:8085',
    },
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
