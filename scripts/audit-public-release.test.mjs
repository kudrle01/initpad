import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { auditPublicPlatformRelease } from './audit-public-release.mjs';

const repository = 'kudrle01/initpad';
const tag = 'initpad-v0.2.0';
const commit = 'a'.repeat(40);
const releaseFiles = [
  'initpad-api-sbom.json',
  'initpad-install-release.sh',
  'initpad-platform-release.json',
  'initpad-release.override.yml',
  'initpad-supervisor-sbom.json',
  'initpad-web-sbom.json',
  'SHA256SUMS',
];

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function fixture() {
  const indexes = {};
  const images = {};
  for (const component of ['api', 'web', 'supervisor']) {
    const index = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        manifests: [
          { platform: { os: 'linux', architecture: 'amd64' } },
          { platform: { os: 'linux', architecture: 'arm64' } },
        ],
      }),
    );
    const imageDigest = digest(index);
    const name = `ghcr.io/kudrle01/initpad-${component}`;
    indexes[name] = index;
    images[component] = {
      name,
      digest: imageDigest,
      immutableReference: `${name}@${imageDigest}`,
      platforms: ['linux/amd64', 'linux/arm64'],
    };
  }
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      component: 'initpad-platform',
      version: '0.2.0',
      source: { repository: `https://github.com/${repository}`, tag, commit },
      images,
      compose: { file: 'initpad-release.override.yml', sha256: 'b'.repeat(64) },
      database: {
        migrationMode: 'expand-contract',
        rollback: 'image-compatible',
        backupRequired: true,
      },
    }),
  );
  const sums = checksums(manifest);
  return { indexes, images, manifest, sums };
}

function checksums(manifest) {
  return Buffer.from(
    releaseFiles
      .filter((name) => name !== 'SHA256SUMS')
      .map((name) => {
        const hash =
          name === 'initpad-platform-release.json' ? digest(manifest).slice(7) : 'c'.repeat(64);
        return `${hash}  ${name}`;
      })
      .join('\n') + '\n',
  );
}

function response(body = '', options = {}) {
  return new Response(body, { status: 200, ...options });
}

function publicFetch(data) {
  const assets = releaseFiles.flatMap((name) => [name, `${name}.sigstore.json`]);
  return async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith(`/repos/${repository}`)) {
      return response(JSON.stringify({ full_name: repository, private: false }));
    }
    if (url.endsWith(`/repos/${repository}/releases/tags/${tag}`)) {
      return response(
        JSON.stringify({
          tag_name: tag,
          draft: false,
          prerelease: false,
          assets: assets.map((name) => ({
            name,
            size: 20,
            browser_download_url: `https://downloads.test/${name}`,
          })),
        }),
      );
    }
    if (options.method === 'HEAD' && url.startsWith('https://downloads.test/')) return response();
    if (url.endsWith('/initpad-platform-release.json')) return response(data.manifest);
    if (url.endsWith('/SHA256SUMS')) return response(data.sums);
    if (url.endsWith('.sigstore.json')) return response('{}');
    if (url.startsWith('https://ghcr.io/token')) {
      return response(JSON.stringify({ token: 't'.repeat(20) }));
    }
    const image = Object.keys(data.indexes).find((name) =>
      url.includes(name.slice('ghcr.io/'.length)),
    );
    if (image) return response(data.indexes[image]);
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
}

test('accepts a complete anonymous signed multiarch platform release', async () => {
  const data = fixture();
  const verified = [];
  const result = await auditPublicPlatformRelease({
    repository,
    tag,
    fetchImpl: publicFetch(data),
    verifyBundle: async (_bundle, bytes, identity) => verified.push([bytes, identity]),
    log: () => {},
  });
  assert.equal(result.sourceCommit, commit);
  assert.equal(verified.length, 2);
  assert.match(verified[0][1], /release-platform\.yml@refs\/tags\/initpad-v0\.2\.0$/);
});

test('rejects a private repository before trusting release metadata', async () => {
  await assert.rejects(
    auditPublicPlatformRelease({
      repository,
      tag,
      fetchImpl: async () => response(JSON.stringify({ full_name: repository, private: true })),
      verifyBundle: async () => {},
      log: () => {},
    }),
    /not publicly readable/,
  );
});

test('rejects an image index without both supported architectures', async () => {
  const data = fixture();
  const apiIndex = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }],
    }),
  );
  data.indexes['ghcr.io/kudrle01/initpad-api'] = apiIndex;
  data.images.api.digest = digest(apiIndex);
  data.images.api.immutableReference = `${data.images.api.name}@${data.images.api.digest}`;
  const manifest = JSON.parse(data.manifest.toString('utf8'));
  manifest.images = data.images;
  data.manifest = Buffer.from(JSON.stringify(manifest));
  data.sums = checksums(data.manifest);

  await assert.rejects(
    auditPublicPlatformRelease({
      repository,
      tag,
      fetchImpl: publicFetch(data),
      verifyBundle: async () => {},
      log: () => {},
    }),
    /missing linux\/arm64/,
  );
});
