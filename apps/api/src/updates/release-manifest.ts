const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IMMUTABLE_IMAGE = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;

export interface AgentReleaseManifest {
  schemaVersion: 1;
  component: 'initpad-agent';
  version: string;
  source: {
    repository: string;
    commit: string;
    tag: string;
  };
  image: {
    name: string;
    digest: string;
    immutableReference: string;
    platforms: string[];
    sbom: string;
  };
  installer: {
    file: string;
    sha256: string;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseStableVersion(version: string): readonly [number, number, number] | null {
  const match = version.match(STABLE_VERSION);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareStableVersions(left: string, right: string): number {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) throw new Error('Cannot compare a non-stable semantic version');
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function parseAgentReleaseManifest(
  value: unknown,
  repository: string,
  expectedTag: string,
): AgentReleaseManifest {
  const manifest = record(value);
  const source = record(manifest?.source);
  const image = record(manifest?.image);
  const installer = record(manifest?.installer);
  const version = manifest?.version;
  const expectedRepository = `https://github.com/${repository}`;
  const expectedVersion = expectedTag.startsWith('agent-v') ? expectedTag.slice(7) : '';
  const platforms = image?.platforms;

  if (
    manifest?.schemaVersion !== 1 ||
    manifest.component !== 'initpad-agent' ||
    typeof version !== 'string' ||
    !parseStableVersion(version) ||
    version !== expectedVersion ||
    source?.repository !== expectedRepository ||
    source.tag !== expectedTag ||
    typeof source.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(source.commit) ||
    typeof image?.name !== 'string' ||
    typeof image.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(image.digest) ||
    typeof image.immutableReference !== 'string' ||
    !IMMUTABLE_IMAGE.test(image.immutableReference) ||
    image.immutableReference !== `${image.name}@${image.digest}` ||
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    !platforms.every(
      (platform) => typeof platform === 'string' && /^linux\/(amd64|arm64)$/.test(platform),
    ) ||
    typeof image.sbom !== 'string' ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(image.sbom) ||
    installer?.file !== 'initpad-agent-install.sh' ||
    typeof installer.sha256 !== 'string' ||
    !SHA256.test(installer.sha256)
  ) {
    throw new Error('Agent release manifest is invalid');
  }

  return manifest as unknown as AgentReleaseManifest;
}
