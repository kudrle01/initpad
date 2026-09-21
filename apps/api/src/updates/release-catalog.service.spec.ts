import { verify } from 'sigstore';
import { config } from '../config';
import { ReleaseCatalogService } from './release-catalog.service';

jest.mock('sigstore', () => ({ verify: jest.fn(async () => ({})) }));

const originalUpdates = { ...config.updates };

function manifest(version = '0.14.1'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    component: 'initpad-agent',
    version,
    source: {
      repository: 'https://github.com/kudrle01/initpad',
      commit: 'a'.repeat(40),
      tag: `agent-v${version}`,
    },
    image: {
      name: 'ghcr.io/kudrle01/initpad-agent',
      digest: `sha256:${'b'.repeat(64)}`,
      immutableReference: `ghcr.io/kudrle01/initpad-agent@sha256:${'b'.repeat(64)}`,
      platforms: ['linux/amd64', 'linux/arm64'],
      sbom: 'initpad-agent-sbom.json',
    },
    installer: { file: 'initpad-agent-install.sh', sha256: 'c'.repeat(64) },
  };
}

function releaseList(version = '0.14.1') {
  return [
    {
      tag_name: `agent-v${version}`,
      html_url: `https://github.com/kudrle01/initpad/releases/tag/agent-v${version}`,
      draft: false,
      prerelease: false,
      published_at: '2026-09-16T10:00:00Z',
      assets: [
        {
          name: 'initpad-agent-release.json',
          url: 'https://api.github.com/repos/kudrle01/initpad/releases/assets/1',
        },
        {
          name: 'initpad-agent-release.json.sigstore.json',
          url: 'https://api.github.com/repos/kudrle01/initpad/releases/assets/2',
        },
      ],
    },
  ];
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('ReleaseCatalogService', () => {
  beforeEach(() => {
    Object.assign(config.updates, {
      enabled: true,
      githubApiUrl: 'https://api.github.com',
      repository: 'kudrle01/initpad',
      cacheSeconds: 900,
      requestTimeoutMs: 8_000,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(config.updates, originalUpdates);
    jest.restoreAllMocks();
  });

  it('returns only a manifest verified for the exact tag workflow identity', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(releaseList(), { etag: 'catalog-v1' }))
      .mockResolvedValueOnce(jsonResponse(manifest()))
      .mockResolvedValueOnce(
        jsonResponse({ mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.3' }),
      );

    const result = await new ReleaseCatalogService().latestAgentRelease();

    expect(result.error).toBeNull();
    expect(result.release?.manifest.version).toBe('0.14.1');
    expect(result.release?.manifest.image.immutableReference).toContain('@sha256:');
    expect(verify).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Buffer),
      expect.objectContaining({
        certificateIssuer: 'https://token.actions.githubusercontent.com',
        certificateIdentityURI:
          'https://github.com/kudrle01/initpad/.github/workflows/release-agent.yml@refs/tags/agent-v0.14.1',
        tlogThreshold: 1,
        ctLogThreshold: 1,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the newest stable release is malformed', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(releaseList()))
      .mockResolvedValueOnce(jsonResponse({ ...manifest(), component: 'other' }))
      .mockResolvedValueOnce(jsonResponse({}));

    const result = await new ReleaseCatalogService().latestAgentRelease();

    expect(result.release).toBeNull();
    expect(result.error).toBe('The release catalog is temporarily unavailable.');
    expect(verify).not.toHaveBeenCalled();
  });

  it.each(['0.13.0', '0.14.0'])(
    'skips published release %s after failed runtime acceptance',
    async (revokedVersion) => {
      const revoked = releaseList(revokedVersion)[0];
      const accepted = releaseList('0.14.1')[0];
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(jsonResponse([revoked, accepted]))
        .mockResolvedValueOnce(jsonResponse(manifest('0.14.1')))
        .mockResolvedValueOnce(jsonResponse({}));

      const result = await new ReleaseCatalogService().latestAgentRelease();

      expect(result.error).toBeNull();
      expect(result.release?.manifest.version).toBe('0.14.1');
      expect(verify).toHaveBeenCalledTimes(1);
    },
  );

  it('serves the last verified result as stale after a refresh failure', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(releaseList()))
      .mockResolvedValueOnce(jsonResponse(manifest()))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockRejectedValueOnce(new Error('network unavailable'));
    const service = new ReleaseCatalogService();

    await expect(service.latestAgentRelease()).resolves.toMatchObject({ stale: false });
    await expect(service.latestAgentRelease(true)).resolves.toMatchObject({
      stale: true,
      release: { manifest: { version: '0.14.1' } },
      error: expect.stringContaining('last verified'),
    });
  });

  it('performs no network request when update checks are disabled', async () => {
    config.updates.enabled = false;
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(new ReleaseCatalogService().latestAgentRelease()).resolves.toEqual({
      enabled: false,
      checkedAt: null,
      stale: false,
      release: null,
      error: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
