import { verify, type Bundle } from 'sigstore';
import { resolve } from 'node:path';
import { stateDirectory } from './state.js';
import type { PlatformImage, PlatformReleaseManifest, SignedPlatformRelease } from './types.js';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMAGE = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_MANIFEST_BYTES = 512 * 1024;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseVersion(value: unknown): readonly [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = value.match(VERSION);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Platform release version is invalid');
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((key) => !expected.includes(key))
  ) {
    throw new Error(`${label} has unsupported fields`);
  }
}

function parseImage(value: unknown): PlatformImage {
  const image = object(value);
  if (!image) throw new Error('Platform release image is invalid');
  exactKeys(image, ['name', 'digest', 'immutableReference', 'platforms'], 'Platform release image');
  if (
    typeof image.name !== 'string' ||
    image.name.includes('@') ||
    image.name.includes(':') ||
    typeof image.digest !== 'string' ||
    !DIGEST.test(image.digest) ||
    typeof image.immutableReference !== 'string' ||
    !IMAGE.test(image.immutableReference) ||
    image.immutableReference !== `${image.name}@${image.digest}` ||
    !Array.isArray(image.platforms) ||
    image.platforms.length !== 2 ||
    image.platforms.some((platform) => typeof platform !== 'string') ||
    !image.platforms.includes('linux/amd64') ||
    !image.platforms.includes('linux/arm64')
  ) {
    throw new Error('Platform release image is invalid');
  }
  return {
    name: image.name,
    digest: image.digest,
    immutableReference: image.immutableReference,
    platforms: ['linux/amd64', 'linux/arm64'],
  };
}

export function parsePlatformReleaseManifest(
  value: unknown,
  repository: string,
  expectedVersion: string,
): PlatformReleaseManifest {
  const manifest = object(value);
  if (!manifest) throw new Error('Platform release manifest is invalid');
  exactKeys(
    manifest,
    ['schemaVersion', 'component', 'version', 'source', 'images', 'compose', 'database'],
    'Platform release manifest',
  );
  const source = object(manifest.source);
  const images = object(manifest.images);
  const compose = object(manifest.compose);
  const database = object(manifest.database);
  if (!source || !images || !compose || !database) {
    throw new Error('Platform release manifest is invalid');
  }
  exactKeys(source, ['repository', 'tag', 'commit'], 'Platform release source');
  exactKeys(images, ['api', 'web', 'supervisor'], 'Platform release images');
  exactKeys(compose, ['file', 'sha256'], 'Platform release Compose descriptor');
  exactKeys(
    database,
    ['migrationMode', 'rollback', 'backupRequired'],
    'Platform release database contract',
  );
  const tag = `initpad-v${expectedVersion}`;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.component !== 'initpad-platform' ||
    manifest.version !== expectedVersion ||
    !parseVersion(manifest.version) ||
    source.repository !== `https://github.com/${repository}` ||
    source.tag !== tag ||
    typeof source.commit !== 'string' ||
    !COMMIT.test(source.commit) ||
    compose.file !== 'initpad-release.override.yml' ||
    typeof compose.sha256 !== 'string' ||
    !SHA256.test(compose.sha256) ||
    database.migrationMode !== 'expand-contract' ||
    database.rollback !== 'image-compatible' ||
    database.backupRequired !== true
  ) {
    throw new Error('Platform release manifest is invalid');
  }
  return {
    schemaVersion: 1,
    component: 'initpad-platform',
    version: expectedVersion,
    source: {
      repository: String(source.repository),
      tag: String(source.tag),
      commit: String(source.commit),
    },
    images: {
      api: parseImage(images.api),
      web: parseImage(images.web),
      supervisor: parseImage(images.supervisor),
    },
    compose: {
      file: 'initpad-release.override.yml',
      sha256: String(compose.sha256),
    },
    database: {
      migrationMode: 'expand-contract',
      rollback: 'image-compatible',
      backupRequired: true,
    },
  };
}

function decodeManifest(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_MANIFEST_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('Platform release manifest encoding is invalid');
  }
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length === 0 ||
    bytes.length > MAX_MANIFEST_BYTES ||
    bytes.toString('base64') !== value
  ) {
    throw new Error('Platform release manifest encoding is invalid');
  }
  return bytes;
}

export async function verifyPlatformRelease(
  value: unknown,
  currentVersion: string,
  repository = process.env.INITPAD_UPDATE_REPOSITORY || 'kudrle01/initpad',
  verifier: typeof verify = verify,
): Promise<PlatformReleaseManifest> {
  const release = object(value);
  if (!release) throw new Error('Signed platform release is invalid');
  exactKeys(release, ['version', 'manifestBase64', 'bundle'], 'Signed platform release');
  if (typeof release.version !== 'string' || !parseVersion(release.version)) {
    throw new Error('Platform release version is invalid');
  }
  if (compareVersions(release.version, currentVersion) <= 0) {
    throw new Error('Platform release must be newer than the installed version');
  }
  const bytes = decodeManifest(release.manifestBase64);
  const bundle = object(release.bundle) as Bundle | null;
  if (!bundle) throw new Error('Platform release signature bundle is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Platform release manifest is not valid JSON');
  }
  const manifest = parsePlatformReleaseManifest(parsed, repository, release.version);
  await verifier(bundle, bytes, {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI:
      `https://github.com/${repository}/.github/workflows/release-platform.yml` +
      `@refs/tags/initpad-v${release.version}`,
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 8_000,
    tufCachePath: resolve(stateDirectory(), 'sigstore-js'),
    tufForceCache: process.env.INITPAD_SIGSTORE_FORCE_CACHE === 'true',
  });
  return manifest;
}

export function asSignedPlatformRelease(value: unknown): SignedPlatformRelease {
  const release = object(value);
  if (
    !release ||
    typeof release.version !== 'string' ||
    typeof release.manifestBase64 !== 'string' ||
    !object(release.bundle)
  ) {
    throw new Error('Signed platform release is invalid');
  }
  return {
    version: release.version,
    manifestBase64: release.manifestBase64,
    bundle: release.bundle,
  };
}
