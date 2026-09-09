import { Injectable } from '@nestjs/common';
import { createSign } from 'crypto';
import { config } from '../../config';
import {
  collectScmPages,
  findInScmPages,
  scmFetch,
  scmStatusError,
} from '../scm-http';

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
    const res = await scmFetch(
      'GitHub',
      'verify App installation',
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
      throw scmStatusError(
        'GitHub',
        'verify App installation',
        res,
        'Could not verify the GitHub App installation',
      );
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
    type InstallationPayload = {
      id?: number | string;
      account?: { id?: number | string; login?: string; type?: string };
      repository_selection?: string;
      suspended_at?: string | null;
    };
    const jwt = this.appJwt();
    const data = await collectScmPages<InstallationPayload>({
      provider: 'GitHub',
      operation: 'list App installations',
      pageSize: 100,
      load: async (page) => {
        const endpoint = new URL(`${config.github.apiBaseUrl}/app/installations`);
        endpoint.searchParams.set('per_page', '100');
        endpoint.searchParams.set('page', String(page));
        const response = await scmFetch('GitHub', 'list App installations', endpoint, {
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (!response.ok) {
          throw scmStatusError(
            'GitHub',
            'list App installations',
            response,
            'Could not list GitHub App installations',
          );
        }
        const pageData = (await response.json()) as InstallationPayload[];
        if (!Array.isArray(pageData)) {
          throw new Error('GitHub returned an invalid installation list');
        }
        return pageData;
      },
    });
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
    const userRes = await scmFetch(
      'GitHub',
      'verify authorizing user',
      `${config.github.apiBaseUrl}/user`,
      { headers },
    );
    if (!userRes.ok) {
      throw scmStatusError(
        'GitHub',
        'verify authorizing user',
        userRes,
        'Could not verify the GitHub user',
      );
    }
    const user = (await userRes.json()) as { id?: number | string };
    if (user.id == null || String(user.id) !== expectedProviderUserId) {
      throw new Error('The authorizing GitHub user does not match the linked identity');
    }

    type InstallationPayload = Parameters<typeof parseInstallation>[0];
    const match = await findInScmPages<InstallationPayload, InstallationPayload>({
      provider: 'GitHub',
      operation: 'verify user installation access',
      pageSize: 100,
      load: async (page) => {
        const endpoint = new URL(`${config.github.apiBaseUrl}/user/installations`);
        endpoint.searchParams.set('per_page', '100');
        endpoint.searchParams.set('page', String(page));
        const response = await scmFetch(
          'GitHub',
          'verify user installation access',
          endpoint,
          { headers },
        );
        if (!response.ok) {
          throw scmStatusError(
            'GitHub',
            'verify user installation access',
            response,
            'Could not verify user installation access',
          );
        }
        const body = (await response.json()) as { installations?: InstallationPayload[] };
        if (!Array.isArray(body.installations)) {
          throw new Error('GitHub returned an invalid user installation list');
        }
        return body.installations;
      },
      find: (installations) =>
        installations.find((candidate) => String(candidate.id) === installationId),
    });
    if (match) return parseInstallation(match);
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
    const res = await scmFetch(
      'GitHub',
      'mint installation token',
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
      throw scmStatusError(
        'GitHub',
        'mint installation token',
        res,
        'Could not mint a GitHub installation token',
      );
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    return { token: data.token, expiresAt: data.expires_at };
  }
}
