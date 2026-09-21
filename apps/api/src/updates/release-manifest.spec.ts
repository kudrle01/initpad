import {
  compareStableVersions,
  parseAgentReleaseManifest,
  parseStableVersion,
} from './release-manifest';

function manifest(version = '0.13.0') {
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
    acceptance: { file: 'initpad-agent-host-acceptance.sh', sha256: 'd'.repeat(64) },
  };
}

describe('Agent release manifest', () => {
  it('accepts an internally consistent immutable release', () => {
    expect(
      parseAgentReleaseManifest(manifest(), 'kudrle01/initpad', 'agent-v0.13.0').image.platforms,
    ).toEqual(['linux/amd64', 'linux/arm64']);
  });

  it('rejects a tag/version mismatch and mutable image', () => {
    expect(() =>
      parseAgentReleaseManifest(manifest(), 'kudrle01/initpad', 'agent-v0.14.0'),
    ).toThrow('invalid');
    const mutable = manifest();
    mutable.image.immutableReference = 'ghcr.io/kudrle01/initpad-agent:latest';
    expect(() => parseAgentReleaseManifest(mutable, 'kudrle01/initpad', 'agent-v0.13.0')).toThrow(
      'invalid',
    );
  });

  it('accepts legacy manifests and rejects a malformed optional acceptance helper', () => {
    const { acceptance: _acceptance, ...legacy } = manifest();
    expect(() =>
      parseAgentReleaseManifest(legacy, 'kudrle01/initpad', 'agent-v0.13.0'),
    ).not.toThrow();

    const malformed = manifest();
    malformed.acceptance.file = '../acceptance.sh';
    expect(() => parseAgentReleaseManifest(malformed, 'kudrle01/initpad', 'agent-v0.13.0')).toThrow(
      'invalid',
    );
  });

  it('compares stable versions without accepting prereleases', () => {
    expect(compareStableVersions('0.13.0', '0.12.9')).toBeGreaterThan(0);
    expect(compareStableVersions('1.0.0', '1.0.0')).toBe(0);
    expect(parseStableVersion('0.13.0-rc.1')).toBeNull();
    expect(parseStableVersion('01.2.3')).toBeNull();
  });
});
