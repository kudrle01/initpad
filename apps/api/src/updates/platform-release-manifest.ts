import { parseStableVersion } from './release-manifest';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMMUTABLE_IMAGE = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface PlatformReleaseImage {
  name: string;
  digest: string;
  immutableReference: string;
  platforms: string[];
}

export interface PlatformReleaseManifest {
  schemaVersion: 1;
  component: 'initpad-platform';
  version: string;
  source: { repository: string; tag: string; commit: string };
  images: Record<'api' | 'web' | 'supervisor', PlatformReleaseImage>;
  compose: { file: 'initpad-release.override.yml'; sha256: string };
  database: {
    migrationMode: 'expand-contract';
    rollback: 'image-compatible';
    backupRequired: true;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function image(value: unknown): PlatformReleaseImage | null {
  const item = record(value);
  if (!item || !exactKeys(item, ['name', 'digest', 'immutableReference', 'platforms'])) return null;
  const platforms = item.platforms;
  if (
    typeof item.name !== 'string' ||
    item.name.includes('@') ||
    item.name.includes(':') ||
    typeof item.digest !== 'string' ||
    !DIGEST.test(item.digest) ||
    typeof item.immutableReference !== 'string' ||
    !IMMUTABLE_IMAGE.test(item.immutableReference) ||
    item.immutableReference !== `${item.name}@${item.digest}` ||
    !Array.isArray(platforms) ||
    platforms.length !== 2 ||
    platforms.some((platform) => typeof platform !== 'string') ||
    !platforms.includes('linux/amd64') ||
    !platforms.includes('linux/arm64')
  ) {
    return null;
  }
  return {
    name: item.name,
    digest: item.digest,
    immutableReference: item.immutableReference,
    platforms: ['linux/amd64', 'linux/arm64'],
  };
}

export function parsePlatformReleaseManifest(
  value: unknown,
  repository: string,
  expectedTag: string,
): PlatformReleaseManifest {
  const manifest = record(value);
  if (
    !manifest ||
    !exactKeys(manifest, [
      'schemaVersion',
      'component',
      'version',
      'source',
      'images',
      'compose',
      'database',
    ])
  ) {
    throw new Error('Platform release manifest is invalid');
  }
  const source = record(manifest.source);
  const images = record(manifest.images);
  const compose = record(manifest.compose);
  const database = record(manifest.database);
  const expectedVersion = expectedTag.startsWith('initpad-v') ? expectedTag.slice(9) : '';
  const api = image(images?.api);
  const web = image(images?.web);
  const supervisor = image(images?.supervisor);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.component !== 'initpad-platform' ||
    typeof manifest.version !== 'string' ||
    !parseStableVersion(manifest.version) ||
    manifest.version !== expectedVersion ||
    !source ||
    !exactKeys(source, ['repository', 'tag', 'commit']) ||
    source.repository !== `https://github.com/${repository}` ||
    source.tag !== expectedTag ||
    typeof source.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(source.commit) ||
    !images ||
    !exactKeys(images, ['api', 'web', 'supervisor']) ||
    !api ||
    !web ||
    !supervisor ||
    !compose ||
    !exactKeys(compose, ['file', 'sha256']) ||
    compose.file !== 'initpad-release.override.yml' ||
    typeof compose.sha256 !== 'string' ||
    !SHA256.test(compose.sha256) ||
    !database ||
    !exactKeys(database, ['migrationMode', 'rollback', 'backupRequired']) ||
    database.migrationMode !== 'expand-contract' ||
    database.rollback !== 'image-compatible' ||
    database.backupRequired !== true
  ) {
    throw new Error('Platform release manifest is invalid');
  }
  return {
    schemaVersion: 1,
    component: 'initpad-platform',
    version: manifest.version,
    source: {
      repository: String(source.repository),
      tag: String(source.tag),
      commit: String(source.commit),
    },
    images: { api, web, supervisor },
    compose: { file: 'initpad-release.override.yml', sha256: compose.sha256 },
    database: {
      migrationMode: 'expand-contract',
      rollback: 'image-compatible',
      backupRequired: true,
    },
  };
}
