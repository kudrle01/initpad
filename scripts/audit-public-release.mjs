#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_LIMIT = 1024 * 1024;
const ASSET_LIMIT = 2 * 1024 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMPONENTS = ['api', 'web', 'supervisor'];
const RELEASE_FILES = [
  'initpad-api-sbom.json',
  'initpad-install-release.sh',
  'initpad-platform-release.json',
  'initpad-release.override.yml',
  'initpad-supervisor-sbom.json',
  'initpad-web-sbom.json',
  'SHA256SUMS',
];

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

async function boundedBytes(response, maximumBytes, label) {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`${label} is larger than ${maximumBytes} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) throw new Error(`${label} is larger than ${maximumBytes} bytes`);
  return bytes;
}

async function json(response, maximumBytes, label) {
  const bytes = await boundedBytes(response, maximumBytes, label);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function request(fetchImpl, url, options = {}) {
  return fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    ...options,
    headers: {
      'User-Agent': 'InitPad-public-release-audit',
      ...options.headers,
    },
  });
}

function validateManifest(value, repository, tag) {
  const manifest = object(value, 'platform release manifest');
  const version = tag.startsWith('initpad-v') ? tag.slice(9) : '';
  const source = object(manifest.source, 'platform release source');
  const images = object(manifest.images, 'platform release images');
  if (
    manifest.schemaVersion !== 1 ||
    manifest.component !== 'initpad-platform' ||
    manifest.version !== version ||
    !VERSION.test(version) ||
    source.repository !== `https://github.com/${repository}` ||
    source.tag !== tag ||
    typeof source.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(source.commit)
  ) {
    throw new Error('platform release manifest identity is invalid');
  }

  const owner = repository.split('/')[0]?.toLowerCase();
  for (const component of COMPONENTS) {
    const image = object(images[component], `${component} image`);
    const expectedName = `ghcr.io/${owner}/initpad-${component}`;
    if (
      image.name !== expectedName ||
      typeof image.digest !== 'string' ||
      !DIGEST.test(image.digest) ||
      image.immutableReference !== `${image.name}@${image.digest}` ||
      !Array.isArray(image.platforms) ||
      !image.platforms.includes('linux/amd64') ||
      !image.platforms.includes('linux/arm64')
    ) {
      throw new Error(`${component} image identity is invalid`);
    }
  }
  return manifest;
}

function parseChecksums(bytes) {
  const entries = new Map();
  for (const line of bytes.toString('utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || entries.has(match[2])) throw new Error('SHA256SUMS is invalid');
    entries.set(match[2], match[1]);
  }
  return entries;
}

async function defaultVerifyBundle(bundle, bytes, identity) {
  const { verify } = await import('sigstore');
  await verify(bundle, bytes, {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI: identity,
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 20_000,
  });
}

async function inspectPublicImage(fetchImpl, image) {
  const repositoryPath = image.name.slice('ghcr.io/'.length);
  const tokenUrl = new URL('https://ghcr.io/token');
  tokenUrl.searchParams.set('service', 'ghcr.io');
  tokenUrl.searchParams.set('scope', `repository:${repositoryPath}:pull`);
  const tokenResponse = await json(
    await request(fetchImpl, tokenUrl),
    API_LIMIT,
    `${image.name} anonymous token`,
  );
  const token = object(tokenResponse, `${image.name} anonymous token`).token;
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error(`${image.name} did not issue an anonymous pull token`);
  }

  const manifestUrl = `https://ghcr.io/v2/${repositoryPath}/manifests/${image.digest}`;
  const response = await request(fetchImpl, manifestUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: [
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
      ].join(', '),
    },
  });
  const bytes = await boundedBytes(response, API_LIMIT, `${image.name} manifest`);
  if (sha256(bytes) !== image.digest) {
    throw new Error(`${image.name} returned a different immutable digest`);
  }
  const index = object(JSON.parse(bytes.toString('utf8')), `${image.name} manifest`);
  if (!Array.isArray(index.manifests)) throw new Error(`${image.name} is not a multiarch index`);
  const platforms = index.manifests
    .map((entry) => object(entry, `${image.name} platform`).platform)
    .filter((platform) => platform && typeof platform === 'object')
    .map((platform) => `${platform.os}/${platform.architecture}`);
  for (const required of ['linux/amd64', 'linux/arm64']) {
    if (!platforms.includes(required)) throw new Error(`${image.name} is missing ${required}`);
  }
}

export async function auditPublicPlatformRelease({
  repository = 'kudrle01/initpad',
  tag,
  fetchImpl = fetch,
  verifyBundle = defaultVerifyBundle,
  log = console.log,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('repository must use owner/name format');
  }
  if (!/^initpad-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('tag must use initpad-vMAJOR.MINOR.PATCH format');
  }

  const api = 'https://api.github.com';
  const repositoryInfo = object(
    await json(
      await request(fetchImpl, `${api}/repos/${repository}`),
      API_LIMIT,
      'GitHub repository',
    ),
    'GitHub repository',
  );
  if (repositoryInfo.full_name !== repository || repositoryInfo.private !== false) {
    throw new Error('GitHub repository is not publicly readable');
  }

  const release = object(
    await json(
      await request(fetchImpl, `${api}/repos/${repository}/releases/tags/${tag}`),
      API_LIMIT,
      'GitHub release',
    ),
    'GitHub release',
  );
  if (
    release.tag_name !== tag ||
    release.draft ||
    release.prerelease ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('GitHub release is not a public stable release');
  }
  const assets = new Map(
    release.assets.map((value) => {
      const asset = object(value, 'GitHub release asset');
      if (
        typeof asset.name !== 'string' ||
        typeof asset.browser_download_url !== 'string' ||
        typeof asset.size !== 'number' ||
        asset.size <= 0
      ) {
        throw new Error('GitHub release asset is invalid');
      }
      return [asset.name, asset];
    }),
  );
  const expectedAssets = RELEASE_FILES.flatMap((name) => [name, `${name}.sigstore.json`]);
  for (const name of expectedAssets) {
    const asset = assets.get(name);
    if (!asset) throw new Error(`GitHub release is missing ${name}`);
    const response = await request(fetchImpl, asset.browser_download_url, { method: 'HEAD' });
    if (!response.ok) throw new Error(`${name} is not anonymously downloadable`);
  }

  const download = async (name) =>
    boundedBytes(
      await request(fetchImpl, assets.get(name).browser_download_url),
      ASSET_LIMIT,
      name,
    );
  const [manifestBytes, manifestBundleBytes, checksumBytes, checksumBundleBytes] =
    await Promise.all([
      download('initpad-platform-release.json'),
      download('initpad-platform-release.json.sigstore.json'),
      download('SHA256SUMS'),
      download('SHA256SUMS.sigstore.json'),
    ]);
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')), repository, tag);
  const identity = `https://github.com/${repository}/.github/workflows/release-platform.yml@refs/tags/${tag}`;
  await verifyBundle(JSON.parse(manifestBundleBytes.toString('utf8')), manifestBytes, identity);
  await verifyBundle(JSON.parse(checksumBundleBytes.toString('utf8')), checksumBytes, identity);
  const checksums = parseChecksums(checksumBytes);
  for (const name of RELEASE_FILES.filter((value) => value !== 'SHA256SUMS')) {
    if (!checksums.has(name)) throw new Error(`SHA256SUMS does not cover ${name}`);
  }
  if (checksums.get('initpad-platform-release.json') !== sha256(manifestBytes).slice(7)) {
    throw new Error('platform release manifest checksum does not match');
  }

  for (const component of COMPONENTS) {
    await inspectPublicImage(fetchImpl, manifest.images[component]);
  }
  log(`Public release ${tag} is anonymously readable, signed and multiarch.`);
  return { repository, tag, version: manifest.version, sourceCommit: manifest.source.commit };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const version = JSON.parse(
    readFileSync(resolve(root, 'deploy/platform-version.json'), 'utf8'),
  ).version;
  auditPublicPlatformRelease({
    repository: argument('--repository') ?? 'kudrle01/initpad',
    tag: argument('--tag') ?? `initpad-v${version}`,
  }).catch((error) => {
    console.error(`Public release audit failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
