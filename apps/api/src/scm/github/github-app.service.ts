import { Injectable, Logger } from '@nestjs/common';
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

// Least-privilege default for repository automation (ADR-030): read metadata,
// read/write contents, and write checks. Administration write is requested
// explicitly and only for repository creation.
export const DEFAULT_INSTALLATION_PERMISSIONS = {
  metadata: 'read',
  contents: 'write',
  checks: 'write',
} as const;

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

/**
 * The GitHub App side of the hosted edition (ADR-030): it authenticates as the
 * App and exchanges that for short-lived, narrowly-scoped installation access
 * tokens. It never persists a token. Inert until an App id + private key are
 * configured, so it can never block the Gitea path.
 */
@Injectable()
export class GitHubAppService {
  private readonly logger = new Logger('GitHubAppService');

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
