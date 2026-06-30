import { Injectable } from '@nestjs/common';
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'crypto';
import { config } from '../config';

interface AuthCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  nonce?: string;
  expiresAt: number;
}

// OIDC provider platformy: drží podpisový klíč, vydává autorizační kódy,
// access tokeny a podepisuje id_token (RS256). Stav je in-memory (prototyp).
@Injectable()
export class OidcService {
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { kty: string; n: string; e: string };
  readonly kid: string;

  private readonly codes = new Map<string, AuthCode>();
  private readonly accessTokens = new Map<string, { userId: string; expiresAt: number }>();

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: 'jwk' }) as {
      kty: string;
      n: string;
      e: string;
    };
    this.kid = createHash('sha256').update(this.publicJwk.n).digest('base64url').slice(0, 16);
  }

  // --- discovery + JWKS ---

  discovery() {
    const iss = config.oidc.issuer; // server-facing (host.docker.internal)
    const pub = config.oidc.publicUrl; // browser-facing (localhost)
    return {
      issuer: iss,
      // authorize jde přes prohlížeč → veřejná adresa; ostatní volá Gitea server.
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

  // --- klient (Gitea) ---

  validateClient(clientId: string, clientSecret: string): boolean {
    return clientId === config.oidc.clientId && clientSecret === config.oidc.clientSecret;
  }

  isKnownClient(clientId: string): boolean {
    return clientId === config.oidc.clientId;
  }

  // Redirect URI musí mířit na Giteu (zabrání zneužití jako open redirector).
  isAllowedRedirect(redirectUri: string): boolean {
    const gitea = config.gitea.url?.replace(/\/$/, '');
    return Boolean(gitea && redirectUri.startsWith(gitea));
  }

  // --- autorizační kódy ---

  issueCode(input: Omit<AuthCode, 'expiresAt'>): string {
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, { ...input, expiresAt: Date.now() + 5 * 60_000 });
    return code;
  }

  consumeCode(code: string): AuthCode | null {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry;
  }

  // --- access tokeny (pro userinfo) ---

  issueAccessToken(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.accessTokens.set(token, { userId, expiresAt: Date.now() + 60 * 60_000 });
    return token;
  }

  userIdForToken(token: string): string | null {
    const entry = this.accessTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.userId;
  }

  // --- id_token (RS256 JWT, podepsaný ručně přes crypto) ---

  signIdToken(claims: Record<string, unknown>): string {
    const header = { alg: 'RS256', typ: 'JWT', kid: this.kid };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: config.oidc.issuer, iat: now, exp: now + 3600, ...claims };
    const encode = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const data = `${encode(header)}.${encode(payload)}`;
    const signature = createSign('RSA-SHA256')
      .update(data)
      .end()
      .sign(this.privateKey)
      .toString('base64url');
    return `${data}.${signature}`;
  }
}
