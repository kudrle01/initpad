import { Injectable, Logger } from '@nestjs/common';
import { verify, type Bundle } from 'sigstore';
import { config } from '../config';
import { compareStableVersions, parseStableVersion } from './release-manifest';
import {
  parsePlatformReleaseManifest,
  type PlatformReleaseManifest,
} from './platform-release-manifest';

const LIST_LIMIT = 512 * 1024;
const ASSET_LIMIT = 2 * 1024 * 1024;
const MANIFEST_NAME = 'initpad-platform-release.json';
const BUNDLE_NAME = `${MANIFEST_NAME}.sigstore.json`;

interface ReleaseAsset {
  name: string;
  url: string;
}

interface ReleaseEntry {
  tag: string;
  url: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

export interface VerifiedPlatformRelease {
  manifest: PlatformReleaseManifest;
  manifestBase64: string;
  bundle: Bundle;
  releaseUrl: string;
  publishedAt: string | null;
  verifiedAt: string;
}

export interface PlatformCatalogResult {
  enabled: boolean;
  checkedAt: string | null;
  stale: boolean;
  release: VerifiedPlatformRelease | null;
  error: string | null;
}

@Injectable()
export class PlatformReleaseCatalogService {
  private readonly logger = new Logger(PlatformReleaseCatalogService.name);
  private cached: { expiresAt: number; result: PlatformCatalogResult } | null = null;
  private inFlight: Promise<PlatformCatalogResult> | null = null;
  private lastGood: PlatformCatalogResult | null = null;

  async latest(force = false): Promise<PlatformCatalogResult> {
    if (!config.updates.enabled) {
      return { enabled: false, checkedAt: null, stale: false, release: null, error: null };
    }
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.result;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refresh()
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.inFlight = null;
      });
    const result = await this.inFlight;
    this.cached = { expiresAt: Date.now() + config.updates.cacheSeconds * 1_000, result };
    if (!result.error) this.lastGood = result;
    return result;
  }

  private async refresh(): Promise<PlatformCatalogResult> {
    const base = config.updates.githubApiUrl.replace(/\/$/, '');
    const list = await this.fetchBounded(
      `${base}/repos/${config.updates.repository}/releases?per_page=20`,
      LIST_LIMIT,
      'application/vnd.github+json',
    );
    if (!list.ok) throw new Error(`platform release catalog returned HTTP ${list.status}`);
    const checkedAt = new Date().toISOString();
    const candidate = this.parseList(list.body)
      .filter((release) => !release.draft && !release.prerelease)
      .filter((release) => release.tag.startsWith('initpad-v'))
      .filter((release) => parseStableVersion(release.tag.slice(9)))
      .sort((left, right) => compareStableVersions(right.tag.slice(9), left.tag.slice(9)))[0];
    if (!candidate) {
      return { enabled: true, checkedAt, stale: false, release: null, error: null };
    }
    const manifestAsset = candidate.assets.find((asset) => asset.name === MANIFEST_NAME);
    const bundleAsset = candidate.assets.find((asset) => asset.name === BUNDLE_NAME);
    if (!manifestAsset || !bundleAsset) throw new Error('latest platform release is incomplete');
    this.assertAssetUrl(manifestAsset.url, base);
    this.assertAssetUrl(bundleAsset.url, base);
    const [manifestResponse, bundleResponse] = await Promise.all([
      this.fetchBounded(manifestAsset.url, ASSET_LIMIT, 'application/octet-stream'),
      this.fetchBounded(bundleAsset.url, ASSET_LIMIT, 'application/octet-stream'),
    ]);
    if (!manifestResponse.ok || !bundleResponse.ok) {
      throw new Error('latest platform release assets could not be downloaded');
    }
    let manifestValue: unknown;
    let bundle: Bundle;
    try {
      manifestValue = JSON.parse(manifestResponse.body.toString('utf8')) as unknown;
      bundle = JSON.parse(bundleResponse.body.toString('utf8')) as Bundle;
    } catch {
      throw new Error('latest platform release assets are not valid JSON');
    }
    const manifest = parsePlatformReleaseManifest(
      manifestValue,
      config.updates.repository,
      candidate.tag,
    );
    await verify(bundle, manifestResponse.body, {
      certificateIssuer: 'https://token.actions.githubusercontent.com',
      certificateIdentityURI:
        `https://github.com/${config.updates.repository}/.github/workflows/release-platform.yml` +
        `@refs/tags/${candidate.tag}`,
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
        manifestBase64: manifestResponse.body.toString('base64'),
        bundle,
        releaseUrl: candidate.url,
        publishedAt: candidate.publishedAt,
        verifiedAt: checkedAt,
      },
      error: null,
    };
  }

  private failed(error: unknown): PlatformCatalogResult {
    this.logger.warn({
      event: 'updates.platform_catalog.unavailable',
      reason: error instanceof Error ? error.message : 'unknown failure',
    });
    if (this.lastGood) {
      return {
        ...this.lastGood,
        stale: true,
        error:
          'The platform release catalog could not be refreshed; showing the last verified result.',
      };
    }
    return {
      enabled: true,
      checkedAt: new Date().toISOString(),
      stale: false,
      release: null,
      error: 'The platform release catalog is temporarily unavailable.',
    };
  }

  private parseList(bytes: Buffer): ReleaseEntry[] {
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new Error('platform release catalog is not valid JSON');
    }
    if (!Array.isArray(value) || value.length > 20)
      throw new Error('platform release catalog is invalid');
    return value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('platform release catalog entry is invalid');
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
        throw new Error('platform release catalog entry is invalid');
      }
      const assets = release.assets.map((itemAsset) => {
        if (!itemAsset || typeof itemAsset !== 'object' || Array.isArray(itemAsset)) {
          throw new Error('platform release catalog asset is invalid');
        }
        const asset = itemAsset as Record<string, unknown>;
        if (typeof asset.name !== 'string' || typeof asset.url !== 'string') {
          throw new Error('platform release catalog asset is invalid');
        }
        return { name: asset.name, url: asset.url };
      });
      return {
        tag: release.tag_name,
        url: release.html_url,
        draft: release.draft,
        prerelease: release.prerelease,
        publishedAt: release.published_at,
        assets,
      };
    });
  }

  private assertAssetUrl(value: string, apiBase: string): void {
    let asset: URL;
    try {
      asset = new URL(value);
    } catch {
      throw new Error('platform release asset URL is invalid');
    }
    if (asset.protocol !== 'https:' || asset.origin !== new URL(apiBase).origin) {
      throw new Error('platform release asset URL is outside the configured GitHub API');
    }
  }

  private async fetchBounded(url: string, maximumBytes: number, accept: string) {
    const response = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'InitPad-platform-update-catalog' },
      redirect: 'follow',
      signal: AbortSignal.timeout(config.updates.requestTimeoutMs),
    });
    if (Number(response.headers.get('content-length') || 0) > maximumBytes) {
      throw new Error('platform release response is too large');
    }
    if (!response.body) {
      return { status: response.status, ok: response.ok, body: Buffer.alloc(0) };
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('platform release response is too large');
      }
      chunks.push(Buffer.from(value));
    }
    return { status: response.status, ok: response.ok, body: Buffer.concat(chunks) };
  }
}
