import { verify } from 'sigstore';
import { config } from '../config';
import { PlatformReleaseCatalogService } from './platform-release-catalog.service';

jest.mock('sigstore', () => ({ verify: jest.fn(async () => ({})) }));

const original = { ...config.updates };

function manifest(version = '0.2.0') {
  const image = (component: string, letter: string) => ({
    name: `ghcr.io/kudrle01/initpad-${component}`,
    digest: `sha256:${letter.repeat(64)}`,
    immutableReference: `ghcr.io/kudrle01/initpad-${component}@sha256:${letter.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  });
  return {
    schemaVersion: 1,
    component: 'initpad-platform',
    version,
    source: {
      repository: 'https://github.com/kudrle01/initpad',
      tag: `initpad-v${version}`,
      commit: 'd'.repeat(40),
    },
    images: {
      api: image('api', 'a'),
      web: image('web', 'b'),
      supervisor: image('supervisor', 'c'),
    },
    compose: { file: 'initpad-release.override.yml', sha256: 'e'.repeat(64) },
    database: {
      migrationMode: 'expand-contract',
      rollback: 'image-compatible',
      backupRequired: true,
    },
  };
}

function releases(version = '0.2.0', prerelease = false) {
  return [
    {
      tag_name: `initpad-v${version}`,
      html_url: `https://github.com/kudrle01/initpad/releases/tag/initpad-v${version}`,
      draft: false,
      prerelease,
      published_at: '2026-09-16T10:00:00Z',
      assets: [
        {
          name: 'initpad-platform-release.json',
          url: 'https://api.github.com/repos/kudrle01/initpad/releases/assets/10',
        },
        {
          name: 'initpad-platform-release.json.sigstore.json',
          url: 'https://api.github.com/repos/kudrle01/initpad/releases/assets/11',
        },
      ],
    },
  ];
}

function release(version: string) {
  return releases(version)[0];
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe('PlatformReleaseCatalogService', () => {
  beforeEach(() => {
    Object.assign(config.updates, {
      enabled: true,
      platformChannel: 'stable',
      githubApiUrl: 'https://api.github.com',
      repository: 'kudrle01/initpad',
      cacheSeconds: 900,
      requestTimeoutMs: 8_000,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(config.updates, original);
    jest.restoreAllMocks();
  });

  it('returns only a platform manifest signed by its exact tag workflow', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(releases()))
      .mockResolvedValueOnce(response(manifest()))
      .mockResolvedValueOnce(
        response({ mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json' }),
      );

    const result = await new PlatformReleaseCatalogService().latest();

    expect(result.release?.manifest.version).toBe('0.2.0');
    expect(result.release?.manifest.images.api.immutableReference).toContain('@sha256:');
    expect(verify).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Buffer),
      expect.objectContaining({
        certificateIdentityURI:
          'https://github.com/kudrle01/initpad/.github/workflows/release-platform.yml@refs/tags/initpad-v0.2.0',
      }),
    );
  });

  it('accepts a release list larger than 512 KiB, as GitHub now returns', async () => {
    const large = [{ ...release('0.2.1'), body: 'x'.repeat(600 * 1024) }];
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(large))
      .mockResolvedValueOnce(response(manifest('0.2.1')))
      .mockResolvedValueOnce(response({}));

    const result = await new PlatformReleaseCatalogService().latest();

    expect(result.error).toBeNull();
    expect(result.release?.manifest.version).toBe('0.2.1');
  });

  it('bypasses the cache on an explicit refresh and reports why it failed', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(releases()))
      .mockResolvedValueOnce(response(manifest()))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const catalog = new PlatformReleaseCatalogService();
    await catalog.latest();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000);

    expect((await catalog.latest()).stale).toBe(false);
    const refreshed = await catalog.latest(true);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(refreshed).toMatchObject({ stale: true, release: { manifest: { version: '0.2.0' } } });
    expect(refreshed.error).toContain('HTTP 503');
  });

  it('fails closed when the latest stable release is malformed', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(releases()))
      .mockResolvedValueOnce(response({ ...manifest(), command: ['sh'] }))
      .mockResolvedValueOnce(response({}));

    await expect(new PlatformReleaseCatalogService().latest()).resolves.toMatchObject({
      release: null,
      error: 'The platform release catalog is temporarily unavailable.',
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps platform prereleases out of the stable channel', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response([releases('0.3.0', true)[0], release('0.2.9')]))
      .mockResolvedValueOnce(response(manifest('0.2.9')))
      .mockResolvedValueOnce(response({}));

    const result = await new PlatformReleaseCatalogService().latest();

    expect(result.channel).toBe('stable');
    expect(result.release?.manifest.version).toBe('0.2.9');
  });

  it('allows a disposable control plane to select a platform candidate', async () => {
    config.updates.platformChannel = 'candidate';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response([release('0.2.9'), releases('0.3.0', true)[0]]))
      .mockResolvedValueOnce(response(manifest('0.3.0')))
      .mockResolvedValueOnce(response({}));

    const result = await new PlatformReleaseCatalogService().latest();

    expect(result.channel).toBe('candidate');
    expect(result.release?.manifest.version).toBe('0.3.0');
  });

  it('skips a runtime-revoked platform release', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response([release('0.2.5'), release('0.2.4')]))
      .mockResolvedValueOnce(response(manifest('0.2.4')))
      .mockResolvedValueOnce(
        response({ mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json' }),
      );

    const result = await new PlatformReleaseCatalogService().latest();

    expect(result.release?.manifest.version).toBe('0.2.4');
  });
});
