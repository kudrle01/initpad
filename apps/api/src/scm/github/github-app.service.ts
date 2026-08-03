import { Injectable } from '@nestjs/common';
import { createSign } from 'crypto';
import { config } from '../../config';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mints the GitHub App JWT (RS256) used to authenticate as the App itself.
 * Per GitHub's rules the token lives at most 10 minutes; `iat` is backdated 60s
 * to tolerate clock skew. Exported as a pure function so it is unit-testable
 * against a generated key pair without a network.
 */
export function signAppJwt(appId: string, privateKeyPem: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000) - 60;
  const exp = Math.floor(nowMs / 1000) + 9 * 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp, iss: appId }));
  const data = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(data).sign(privateKeyPem);
  return `${data}.${base64url(signature)}`;
}

// Least-privilege default for repository inspection. Mutating callers request
// their operation-specific permissions explicitly; an installation token must
// never receive write permissions merely because another endpoint needs them.
export const DEFAULT_INSTALLATION_PERMISSIONS = {
  metadata: 'read',
  contents: 'read',
} as const;

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

export interface VerifiedGitHubInstallation {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repositorySelection: string;
  suspendedAt: Date | null;
}

function parseInstallation(data: {
  id?: number | string;
  account?: { id?: number | string; login?: string; type?: string };
  repository_selection?: string;
  suspended_at?: string | null;
}): VerifiedGitHubInstallation {
  if (
    data.id == null ||
    data.account?.id == null ||
    !data.account.login ||
    (data.account.type !== 'User' && data.account.type !== 'Organization')
  ) {
    throw new Error('GitHub returned an incomplete installation identity');
  }
  return {
    installationId: String(data.id),
    accountId: String(data.account.id),
    accountLogin: data.account.login,
    accountType: data.account.type,
    repositorySelection: data.repository_selection ?? 'selected',
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
  };
}

/**
 * The GitHub App side of the hosted edition (ADR-030): it authenticates as the
 * App and exchanges that for short-lived, narrowly-scoped installation access
 * tokens. It never persists a token. Inert until an App id + private key are
 * configured, so it can never block the Gitea path.
 */
@Injectable()
export class GitHubAppService {
  isConfigured(): boolean {
    return Boolean(config.github.appId && config.github.privateKey);
  }

  private appJwt(): string {
    if (!this.isConfigured()) {
      throw new Error('GitHub App is not configured (INITPAD_GITHUB_APP_ID / PRIVATE_KEY)');
    }
    return signAppJwt(config.github.appId, config.github.privateKey);
  }

  /**
   * Resolves an installation as the App itself. Setup callbacks contain only
   * untrusted query parameters; this lookup is the authoritative source of the
   * immutable account id, current login/type and installation state.
   */
  async getInstallation(installationId: string | number): Promise<VerifiedGitHubInstallation> {
    const res = await fetch(
      `${config.github.apiBaseUrl}/app/installations/${encodeURIComponent(String(installationId))}`,
      {
        headers: {
          Authorization: `Bearer ${this.appJwt()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Could not verify the GitHub App installation (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      id?: number | string;
      account?: { id?: number | string; login?: string; type?: string };
      repository_selection?: string;
      suspended_at?: string | null;
    };
    return parseInstallation(data);
  }

  /** Lists active App installations for personal-account setup recovery. */
  async listInstallations(): Promise<VerifiedGitHubInstallation[]> {
    const res = await fetch(`${config.github.apiBaseUrl}/app/installations?per_page=100`, {
      headers: {
        Authorization: `Bearer ${this.appJwt()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`Could not list GitHub App installations (HTTP ${res.status})`);
    }
    const data = (await res.json()) as Array<{
      id?: number | string;
      account?: { id?: number | string; login?: string; type?: string };
      repository_selection?: string;
      suspended_at?: string | null;
    }>;
    if (!Array.isArray(data)) throw new Error('GitHub returned an invalid installation list');
    return data.map(parseInstallation);
  }

  /**
   * Verifies an organization installation against a transient GitHub App user
   * access token. The token is used only for these requests and never stored.
   */
  async getUserAccessibleInstallation(
    userAccessToken: string,
    installationId: string,
    expectedProviderUserId: string,
  ): Promise<VerifiedGitHubInstallation> {
    const headers = {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const userRes = await fetch(`${config.github.apiBaseUrl}/user`, { headers });
    if (!userRes.ok) {
      throw new Error(`Could not verify the GitHub user (HTTP ${userRes.status})`);
    }
    const user = (await userRes.json()) as { id?: number | string };
    if (user.id == null || String(user.id) !== expectedProviderUserId) {
      throw new Error('The authorizing GitHub user does not match the linked identity');
    }

    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(`${config.github.apiBaseUrl}/user/installations`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Could not verify user installation access (HTTP ${response.status})`);
      }
      const body = (await response.json()) as {
        installations?: Array<{
          id?: number | string;
          account?: { id?: number | string; login?: string; type?: string };
          repository_selection?: string;
          suspended_at?: string | null;
        }>;
      };
      if (!Array.isArray(body.installations)) {
        throw new Error('GitHub returned an invalid user installation list');
      }
      const match = body.installations.find((candidate) => String(candidate.id) === installationId);
      if (match) return parseInstallation(match);
      if (body.installations.length < 100) break;
    }
    throw new Error('The authorizing GitHub user cannot access this installation');
  }

  /**
   * Exchanges the App JWT for an installation access token, optionally scoped to
   * specific repositories and a permission subset. The token is short-lived and
   * returned to the caller, never stored.
   */
  async createInstallationToken(
    installationId: string | number,
    options?: { permissions?: Record<string, string>; repositoryIds?: number[] },
  ): Promise<InstallationToken> {
    const res = await fetch(
      `${config.github.apiBaseUrl}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appJwt()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          permissions: options?.permissions ?? DEFAULT_INSTALLATION_PERMISSIONS,
          ...(options?.repositoryIds ? { repository_ids: options.repositoryIds } : {}),
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Could not mint a GitHub installation token (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    return { token: data.token, expiresAt: data.expires_at };
  }
}
