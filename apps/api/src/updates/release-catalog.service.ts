import { Injectable, Logger } from '@nestjs/common';
import { verify, type Bundle } from 'sigstore';
import { config } from '../config';
import {
  compareStableVersions,
  parseAgentReleaseManifest,
  parseStableVersion,
  type AgentReleaseManifest,
} from './release-manifest';

const RELEASE_LIST_BYTES = 512 * 1024;
const RELEASE_ASSET_BYTES = 2 * 1024 * 1024;
const AGENT_MANIFEST = 'initpad-agent-release.json';
const AGENT_BUNDLE = `${AGENT_MANIFEST}.sigstore.json`;
// Published tags remain immutable for auditability. Releases that passed the
// distribution checks but failed runtime acceptance are explicitly revoked.
const REVOKED_AGENT_RELEASES = new Set(['0.14.0']);

interface GitHubAsset {
  name: string;
  url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubAsset[];
}

export interface VerifiedAgentRelease {
  manifest: AgentReleaseManifest;
  manifestBase64: string;
  bundle: Bundle;
  releaseUrl: string;
  publishedAt: string | null;
  verifiedAt: string;
}

export interface AgentCatalogResult {
  enabled: boolean;
  checkedAt: string | null;
  stale: boolean;
  release: VerifiedAgentRelease | null;
  error: string | null;
}

interface CachedCatalog {
  expiresAt: number;
  result: AgentCatalogResult;
}

@Injectable()
export class ReleaseCatalogService {
  private readonly logger = new Logger(ReleaseCatalogService.name);
  private cached: CachedCatalog | null = null;
  private lastGood: AgentCatalogResult | null = null;
  private inFlight: Promise<AgentCatalogResult> | null = null;
  private etag: string | null = null;

  async latestAgentRelease(force = false): Promise<AgentCatalogResult> {
    if (!config.updates.enabled) {
      return { enabled: false, checkedAt: null, stale: false, release: null, error: null };
    }
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.result;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.refresh()
      .catch((error: unknown) => this.failedResult(error))
      .finally(() => {
        this.inFlight = null;
      });
    const result = await this.inFlight;
    this.cached = {
      expiresAt: Date.now() + config.updates.cacheSeconds * 1_000,
      result,
    };
    if (!result.error) this.lastGood = result;
    return result;
  }

  private async refresh(): Promise<AgentCatalogResult> {
    const apiBase = config.updates.githubApiUrl.replace(/\/$/, '');
    const listUrl = `${apiBase}/repos/${config.updates.repository}/releases?per_page=20`;
    const response = await this.fetchBounded(listUrl, RELEASE_LIST_BYTES, {
      Accept: 'application/vnd.github+json',
      ...(this.etag ? { 'If-None-Match': this.etag } : {}),
    });
    const checkedAt = new Date().toISOString();
    if (response.status === 304 && this.lastGood) {
      return { ...this.lastGood, checkedAt, stale: false, error: null };
    }
    if (!response.ok) throw new Error(`release catalog returned HTTP ${response.status}`);
    this.etag = response.headers.get('etag');

    const releases = this.parseReleaseList(response.body);
    const candidate = releases
      .filter((release) => !release.draft && !release.prerelease)
      .filter((release) => release.tag_name.startsWith('agent-v'))
      .filter((release) => {
        const version = release.tag_name.slice(7);
        return parseStableVersion(version) && !REVOKED_AGENT_RELEASES.has(version);
      })
      .sort((left, right) =>
        compareStableVersions(right.tag_name.slice(7), left.tag_name.slice(7)),
      )[0];
    if (!candidate) {
      return { enabled: true, checkedAt, stale: false, release: null, error: null };
    }

    const manifestAsset = candidate.assets.find((asset) => asset.name === AGENT_MANIFEST);
    const bundleAsset = candidate.assets.find((asset) => asset.name === AGENT_BUNDLE);
    if (!manifestAsset || !bundleAsset) throw new Error('latest Agent release is incomplete');
    this.assertAssetUrl(manifestAsset.url, apiBase);
    this.assertAssetUrl(bundleAsset.url, apiBase);

    const [manifestResponse, bundleResponse] = await Promise.all([
      this.fetchBounded(manifestAsset.url, RELEASE_ASSET_BYTES, {
        Accept: 'application/octet-stream',
      }),
      this.fetchBounded(bundleAsset.url, RELEASE_ASSET_BYTES, {
        Accept: 'application/octet-stream',
      }),
    ]);
    if (!manifestResponse.ok || !bundleResponse.ok) {
      throw new Error('latest Agent release assets could not be downloaded');
    }

    const manifestBytes = manifestResponse.body;
    let bundle: Bundle;
    let manifestValue: unknown;
    try {
      bundle = JSON.parse(bundleResponse.body.toString('utf8')) as Bundle;
      manifestValue = JSON.parse(manifestBytes.toString('utf8')) as unknown;
    } catch {
      throw new Error('latest Agent release assets are not valid JSON');
    }
    const manifest = parseAgentReleaseManifest(
      manifestValue,
      config.updates.repository,
      candidate.tag_name,
    );
    await verify(bundle, manifestBytes, {
      certificateIssuer: 'https://token.actions.githubusercontent.com',
      certificateIdentityURI:
        `https://github.com/${config.updates.repository}/.github/workflows/release-agent.yml` +
        `@refs/tags/${candidate.tag_name}`,
      tlogThreshold: 1,
      ctLogThreshold: 1,
      timeout: config.updates.requestTimeoutMs,
      tufCachePath: config.updates.sigstoreCachePath,
    });

    return {
      enabled: true,
      checkedAt,
      stale: false,
      release: {
        manifest,
        manifestBase64: manifestBytes.toString('base64'),
        bundle,
        releaseUrl: candidate.html_url,
        publishedAt: candidate.published_at,
        verifiedAt: checkedAt,
      },
      error: null,
    };
  }

  private failedResult(error: unknown): AgentCatalogResult {
    this.logger.warn({
      event: 'updates.catalog.unavailable',
      reason: error instanceof Error ? error.message : 'unknown failure',
    });
    if (this.lastGood) {
      return {
        ...this.lastGood,
        stale: true,
        error: 'The release catalog could not be refreshed; showing the last verified result.',
      };
    }
    return {
      enabled: true,
      checkedAt: new Date().toISOString(),
      stale: false,
      release: null,
      error: 'The release catalog is temporarily unavailable.',
    };
  }

  private parseReleaseList(bytes: Buffer): GitHubRelease[] {
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new Error('release catalog is not valid JSON');
    }
    if (!Array.isArray(value) || value.length > 20) throw new Error('release catalog is invalid');
    return value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('release catalog entry is invalid');
      }
      const release = item as Record<string, unknown>;
      if (
        typeof release.tag_name !== 'string' ||
        typeof release.html_url !== 'string' ||
        typeof release.draft !== 'boolean' ||
        typeof release.prerelease !== 'boolean' ||
        (release.published_at !== null && typeof release.published_at !== 'string') ||
        !Array.isArray(release.assets) ||
        release.assets.length > 100
      ) {
        throw new Error('release catalog entry is invalid');
      }
      const assets = release.assets.map((itemAsset) => {
        if (!itemAsset || typeof itemAsset !== 'object' || Array.isArray(itemAsset)) {
          throw new Error('release catalog asset is invalid');
        }
        const asset = itemAsset as Record<string, unknown>;
        if (typeof asset.name !== 'string' || typeof asset.url !== 'string') {
          throw new Error('release catalog asset is invalid');
        }
        return { name: asset.name, url: asset.url };
      });
      return {
        tag_name: release.tag_name,
        html_url: release.html_url,
        draft: release.draft,
        prerelease: release.prerelease,
        published_at: release.published_at,
        assets,
      };
    });
  }

  private assertAssetUrl(assetUrl: string, apiBase: string): void {
    let asset: URL;
    const base = new URL(apiBase);
    try {
      asset = new URL(assetUrl);
    } catch {
      throw new Error('release catalog asset URL is invalid');
    }
    if (asset.protocol !== 'https:' || asset.origin !== base.origin) {
      throw new Error('release catalog asset URL is outside the configured GitHub API');
    }
  }

  private async fetchBounded(
    url: string,
    maximumBytes: number,
    headers: Record<string, string>,
  ): Promise<{ status: number; ok: boolean; headers: Headers; body: Buffer }> {
    const response = await fetch(url, {
      headers: { ...headers, 'User-Agent': 'InitPad-update-catalog' },
      redirect: 'follow',
      signal: AbortSignal.timeout(config.updates.requestTimeoutMs),
    });
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maximumBytes) throw new Error('release catalog response is too large');
    if (!response.body)
      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        body: Buffer.alloc(0),
      };

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('release catalog response is too large');
      }
      chunks.push(Buffer.from(value));
    }
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: Buffer.concat(chunks),
    };
  }
}
