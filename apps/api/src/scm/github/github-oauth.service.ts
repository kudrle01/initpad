import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../../config';

export type OAuthMode = 'login' | 'link';

export interface GitHubUser {
  providerUserId: string; // immutable numeric id, as a string
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

// A signed OAuth `state` is valid for 10 minutes. It binds the flow's mode and a
// nonce; the nonce is also stored in a cookie (double-submit) so a forged
// callback cannot complete the flow.
const STATE_TTL_MS = 10 * 60 * 1000;

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * The OAuth user-authorization half of the GitHub App (ADR-030): "Sign in with
 * GitHub" and linking a GitHub identity to an existing InitPad account. It only
 * authenticates identity — repository access is a separate installation-token
 * concern. Inert until an OAuth client id/secret are configured.
 */
@Injectable()
export class GitHubOAuthService {
  isConfigured(): boolean {
    return Boolean(config.github.clientId && config.github.clientSecret && config.github.callbackUrl);
  }

  /** Builds the GitHub authorize URL and the matching signed state + nonce. */
  authorizeUrl(mode: OAuthMode): { url: string; state: string; nonce: string } {
    const nonce = randomBytes(16).toString('base64url');
    const state = this.signState(mode, nonce, Date.now());
    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: config.github.callbackUrl,
      scope: 'read:user user:email',
      state,
      allow_signup: 'false',
    });
    return { url: `${config.github.oauthBaseUrl}/login/oauth/authorize?${params}`, state, nonce };
  }

  /** Verifies the signed state (HMAC + freshness); returns its payload or null. */
  verifyState(raw: string | undefined): { mode: OAuthMode; nonce: string } | null {
    if (!raw || !raw.includes('.')) return null;
    const [payload, sig] = raw.split('.', 2);
    const expected = this.hmac(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        mode: OAuthMode;
        nonce: string;
        ts: number;
      };
      if (Date.now() - data.ts > STATE_TTL_MS) return null;
      if (data.mode !== 'login' && data.mode !== 'link') return null;
      return { mode: data.mode, nonce: data.nonce };
    } catch {
      return null;
    }
  }

  /** Exchanges the OAuth code for a token and returns the GitHub user identity. */
  async exchangeCodeForUser(code: string): Promise<GitHubUser> {
    const tokenRes = await fetch(`${config.github.oauthBaseUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: config.github.callbackUrl,
      }),
    });
    if (!tokenRes.ok) throw new Error(`GitHub token exchange failed (HTTP ${tokenRes.status})`);
    const token = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!token.access_token) throw new Error('GitHub did not return an access token');

    const userRes = await fetch(`${config.github.apiBaseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!userRes.ok) throw new Error(`Could not read the GitHub user (HTTP ${userRes.status})`);
    const u = (await userRes.json()) as {
      id: number;
      login: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string | null;
    };
    return {
      providerUserId: String(u.id),
      login: u.login,
      name: u.name ?? null,
      email: u.email ?? null,
      avatarUrl: u.avatar_url ?? null,
    };
  }

  private signState(mode: OAuthMode, nonce: string, ts: number): string {
    const payload = b64url(JSON.stringify({ mode, nonce, ts }));
    return `${payload}.${this.hmac(payload)}`;
  }

  private hmac(payload: string): string {
    return createHmac('sha256', config.auth.jwtSecret).update(payload).digest('base64url');
  }
}
