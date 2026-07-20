import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../../config';

export type OAuthMode = 'login' | 'link' | 'setup';

export const GITHUB_OAUTH_NONCE_COOKIE = 'initpad_gh_oauth';

export type VerifiedOAuthState =
  | { mode: 'login' | 'link'; nonce: string }
  | { mode: 'setup'; nonce: string; setupState: string; installationId: string };

export interface GitHubUser {
  providerUserId: string; // immutable numeric id, as a string
  login: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
}

export interface GitHubOAuthExchange {
  user: GitHubUser;
  token: GitHubUserTokenSet;
}

/** A GitHub App user authorization. Values must never be logged or exposed. */
export interface GitHubUserTokenSet {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
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
  authorizeUrl(mode: Exclude<OAuthMode, 'setup'>): { url: string; state: string; nonce: string } {
    const nonce = randomBytes(16).toString('base64url');
    const state = this.signState({ mode, nonce, ts: Date.now() });
    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: config.github.callbackUrl,
      scope: 'read:user user:email',
      state,
      allow_signup: 'false',
    });
    return { url: `${config.github.oauthBaseUrl}/login/oauth/authorize?${params}`, state, nonce };
  }

  /**
   * Starts a short-lived user authorization used only to prove that the user
   * can access an organization installation. It reuses the App's configured
   * OAuth callback and carries the original one-time workspace setup state.
   */
  authorizeSetupUrl(
    setupState: string,
    installationId: string,
  ): { url: string; state: string; nonce: string } {
    const nonce = randomBytes(16).toString('base64url');
    const state = this.signState({
      mode: 'setup',
      nonce,
      ts: Date.now(),
      setupState,
      installationId,
    });
    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: config.github.callbackUrl,
      state,
    });
    return { url: `${config.github.oauthBaseUrl}/login/oauth/authorize?${params}`, state, nonce };
  }

  /** Verifies the signed state (HMAC + freshness); returns its payload or null. */
  verifyState(raw: string | undefined): VerifiedOAuthState | null {
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
        setupState?: string;
        installationId?: string;
      };
      if (
        !Number.isFinite(data.ts) ||
        Date.now() < data.ts - 60_000 ||
        Date.now() - data.ts > STATE_TTL_MS ||
        typeof data.nonce !== 'string' ||
        data.nonce.length < 16
      ) return null;
      if (data.mode === 'setup') {
        if (!data.setupState || !data.installationId) return null;
        return {
          mode: 'setup',
          nonce: data.nonce,
          setupState: data.setupState,
          installationId: data.installationId,
        };
      }
      if (data.mode !== 'login' && data.mode !== 'link') return null;
      return { mode: data.mode, nonce: data.nonce };
    } catch {
      return null;
    }
  }

  /** Exchanges the OAuth code for a token and returns the GitHub user identity. */
  async exchangeCodeForUser(code: string): Promise<GitHubUser> {
    return (await this.exchangeCode(code)).user;
  }

  /** Exchanges once; the callback either vaults the pair or uses it transiently. */
  async exchangeCode(code: string): Promise<GitHubOAuthExchange> {
    const token = await this.requestToken({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: config.github.callbackUrl,
    });

    const userRes = await fetch(`${config.github.apiBaseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
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
    let email = u.email ?? null;
    let emailVerified = false;
    try {
      const emailsRes = await fetch(`${config.github.apiBaseUrl}/user/emails`, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email?: string;
          primary?: boolean;
          verified?: boolean;
        }>;
        const selected =
          emails.find((candidate) => candidate.primary && candidate.verified && candidate.email) ??
          emails.find((candidate) => candidate.verified && candidate.email);
        if (selected?.email) {
          email = selected.email;
          emailVerified = true;
        }
      }
    } catch {
      // Identity sign-in can proceed without an e-mail; it simply remains
      // unverified until a verified address can be read later.
    }
    return {
      token,
      user: {
        providerUserId: String(u.id),
        login: u.login,
        name: u.name ?? null,
        email,
        emailVerified,
        avatarUrl: u.avatar_url ?? null,
      },
    };
  }

  /**
   * Atomically-used refresh tokens rotate into a complete new token pair.
   * Coordination between API instances is handled by the credential vault.
   */
  async refreshUserToken(refreshToken: string): Promise<GitHubUserTokenSet> {
    return this.requestToken({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async requestToken(parameters: Record<string, string>): Promise<GitHubUserTokenSet> {
    const tokenRes = await fetch(`${config.github.oauthBaseUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(parameters),
    });
    if (!tokenRes.ok) throw new Error(`GitHub token exchange failed (HTTP ${tokenRes.status})`);
    const token = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      error?: string;
    };
    if (!token.access_token) throw new Error('GitHub did not return an access token');

    const accessTokenExpiresAt = this.expiresAt(token.expires_in);
    const refreshTokenExpiresAt = this.expiresAt(token.refresh_token_expires_in);
    // Expiring user tokens always rotate as a pair. Refusing an incomplete
    // response is safer than replacing a usable refresh token with nothing.
    if (accessTokenExpiresAt && (!token.refresh_token || !refreshTokenExpiresAt)) {
      throw new Error('GitHub returned an incomplete expiring user token');
    }
    return {
      accessToken: token.access_token,
      accessTokenExpiresAt,
      refreshToken: token.refresh_token ?? null,
      refreshTokenExpiresAt,
    };
  }

  private expiresAt(seconds: number | undefined): Date | null {
    if (!Number.isFinite(seconds) || Number(seconds) <= 0) return null;
    return new Date(Date.now() + Number(seconds) * 1000);
  }

  private signState(data: Record<string, unknown>): string {
    const payload = b64url(JSON.stringify(data));
    return `${payload}.${this.hmac(payload)}`;
  }

  private hmac(payload: string): string {
    return createHmac('sha256', config.auth.jwtSecret).update(payload).digest('base64url');
  }
}
