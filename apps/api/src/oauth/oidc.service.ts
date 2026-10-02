import { Injectable, Logger } from '@nestjs/common';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

interface AuthCode {
  userId: string;
  tokenVersion: number;
  clientId: string;
  redirectUri: string;
  nonce?: string;
}

const AUTHORIZATION_CODE_TTL_MS = 5 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;

/**
 * The platform's OIDC provider: holds the signing key pair, issues
 * authorization codes and access tokens, and signs id_tokens (RS256).
 *
 * The signing key is persisted to INITPAD_OIDC_KEY_FILE when configured, so
 * SSO sessions survive API restarts. Hashed codes and access tokens live in
 * PostgreSQL so a callback can reach any API replica without exposing bearer
 * plaintext in the database.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger('OidcService');
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { kty: string; n: string; e: string };
  readonly kid: string;

  constructor(private readonly prisma: PrismaService) {
    this.privateKey = this.loadOrCreateKey();
    this.publicJwk = createPublicKey(this.privateKey).export({ format: 'jwk' }) as {
      kty: string;
      n: string;
      e: string;
    };
    this.kid = createHash('sha256').update(this.publicJwk.n).digest('base64url').slice(0, 16);
  }

  // Loads the RSA signing key from the configured file, generating (and
  // persisting) one on first start. Without a configured file the key is
  // in-memory only (dev mode; a restart invalidates issued id_tokens).
  private loadOrCreateKey(): KeyObject {
    const file = config.oidc.keyFile;
    if (file && existsSync(file)) {
      return createPrivateKey(readFileSync(file));
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    if (file) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
          mode: 0o600,
        });
        this.logger.log(`OIDC signing key generated and stored at ${file}`);
      } catch (e) {
        this.logger.warn(`Could not persist OIDC key to ${file}: ${(e as Error).message}`);
      }
    }
    return privateKey;
  }

  // --- discovery + JWKS ---

  discovery() {
    const iss = config.oidc.issuer; // server-facing (host.docker.internal)
    const pub = config.oidc.publicUrl; // browser-facing (localhost)
    return {
      issuer: iss,
      // The authorize endpoint is visited by the browser → public URL;
      // all other endpoints are called by the Gitea server directly.
      authorization_endpoint: `${pub}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      userinfo_endpoint: `${iss}/oauth/userinfo`,
      jwks_uri: `${iss}/oauth/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      claims_supported: ['sub', 'name', 'preferred_username', 'email', 'email_verified'],
    };
  }

  jwks() {
    return {
      keys: [{ ...this.publicJwk, kid: this.kid, use: 'sig', alg: 'RS256' }],
    };
  }

  // --- client validation (Gitea) ---

  validateClient(clientId: string, clientSecret: string): boolean {
    return clientId === config.oidc.clientId && clientSecret === config.oidc.clientSecret;
  }

  isKnownClient(clientId: string): boolean {
    return clientId === config.oidc.clientId;
  }

  // The redirect URI must point at Gitea (prevents open-redirector abuse).
  isAllowedRedirect(redirectUri: string): boolean {
    if (!config.gitea.url || !redirectUri) return false;
    try {
      const expected = new URL(config.gitea.url);
      const actual = new URL(redirectUri);
      return (
        actual.origin === expected.origin &&
        /^\/user\/oauth2\/[A-Za-z0-9._-]+\/callback$/.test(actual.pathname) &&
        !actual.username &&
        !actual.password
      );
    } catch {
      return false;
    }
  }

  // --- authorization codes ---

  async issueCode(input: AuthCode): Promise<string> {
    await this.pruneExpired();
    const code = randomBytes(24).toString('base64url');
    await this.prisma.oidcGrant.create({
      data: {
        kind: 'authorization_code',
        tokenHash: this.tokenHash(code),
        userId: input.userId,
        tokenVersion: input.tokenVersion,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        nonce: input.nonce,
        expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
      },
    });
    return code;
  }

  async consumeCode(code: string): Promise<AuthCode | null> {
    if (!code) return null;
    const tokenHash = this.tokenHash(code);
    const consumedAt = new Date();
    const claimed = await this.prisma.oidcGrant.updateMany({
      where: {
        tokenHash,
        kind: 'authorization_code',
        usedAt: null,
        expiresAt: { gt: consumedAt },
      },
      data: { usedAt: consumedAt },
    });
    if (claimed.count !== 1) return null;
    const entry = await this.prisma.oidcGrant.findUnique({
      where: { tokenHash },
      select: {
        userId: true,
        tokenVersion: true,
        clientId: true,
        redirectUri: true,
        nonce: true,
      },
    });
    if (!entry?.clientId || !entry.redirectUri) return null;
    return {
      userId: entry.userId,
      tokenVersion: entry.tokenVersion,
      clientId: entry.clientId,
      redirectUri: entry.redirectUri,
      ...(entry.nonce ? { nonce: entry.nonce } : {}),
    };
  }

  // --- access tokens (for the userinfo endpoint) ---

  async issueAccessToken(userId: string, tokenVersion: number): Promise<string> {
    await this.pruneExpired();
    const token = randomBytes(32).toString('base64url');
    await this.prisma.oidcGrant.create({
      data: {
        kind: 'access_token',
        tokenHash: this.tokenHash(token),
        userId,
        tokenVersion,
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  async accessForToken(token: string): Promise<{ userId: string; tokenVersion: number } | null> {
    if (!token) return null;
    const entry = await this.prisma.oidcGrant.findFirst({
      where: {
        tokenHash: this.tokenHash(token),
        kind: 'access_token',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { userId: true, tokenVersion: true },
    });
    return entry ?? null;
  }

  private async pruneExpired(): Promise<void> {
    await this.prisma.oidcGrant.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // --- id_token (RS256 JWT, signed manually via node:crypto) ---

  signIdToken(claims: Record<string, unknown>): string {
    const header = { alg: 'RS256', typ: 'JWT', kid: this.kid };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: config.oidc.issuer, iat: now, exp: now + 3600, ...claims };
    const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const data = `${encode(header)}.${encode(payload)}`;
    const signature = createSign('RSA-SHA256')
      .update(data)
      .end()
      .sign(this.privateKey)
      .toString('base64url');
    return `${data}.${signature}`;
  }
}
