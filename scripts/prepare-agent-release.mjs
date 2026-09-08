#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseFiles = {
  installer: 'initpad-agent-install.sh',
  manifest: 'initpad-agent-release.json',
  sbom: 'initpad-agent-sbom.json',
  checksums: 'SHA256SUMS',
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertMatch(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function prepareAgentRelease({
  root = repositoryRoot,
  outputDirectory,
  tag,
  image,
  digest,
  sourceCommit,
  sourceRepository,
  sbomPath,
}) {
  const packagePath = resolve(root, 'apps/agent/package.json');
  const agentPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  const version = requireString(agentPackage.version, 'Agent package version');
  assertMatch(version, /^\d+\.\d+\.\d+$/, 'Agent package version must be stable semver');

  if (tag !== `agent-v${version}`) {
    throw new Error(`release tag must be agent-v${version}, received ${tag || '<empty>'}`);
  }

  requireString(image, 'image');
  assertMatch(
    image,
    /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*\/[a-z0-9][a-z0-9._-]*$/,
    'image must be a lowercase GHCR repository without a tag or digest',
  );
  requireString(digest, 'digest');
  assertMatch(digest, /^sha256:[a-f0-9]{64}$/, 'digest must be a lowercase SHA-256 OCI digest');
  requireString(sourceCommit, 'source commit');
  assertMatch(sourceCommit, /^[a-f0-9]{40}$/, 'source commit must be a full lowercase Git commit SHA');

  let sourceUrl;
  try {
    sourceUrl = new URL(requireString(sourceRepository, 'source repository'));
  } catch {
    throw new Error('source repository must be an absolute HTTPS URL');
  }
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) {
    throw new Error('source repository must be an absolute HTTPS URL without credentials');
  }

  const parsedSbom = JSON.parse(readFileSync(requireString(sbomPath, 'SBOM path'), 'utf8'));
  if (!parsedSbom || typeof parsedSbom !== 'object' || Array.isArray(parsedSbom)) {
    throw new Error('SBOM must contain a JSON object');
  }

  const output = resolve(requireString(outputDirectory, 'output directory'));
  mkdirSync(output, { recursive: true, mode: 0o755 });

  const installerBytes = readFileSync(resolve(root, 'apps/agent/install.sh'));
  const installerPath = resolve(output, releaseFiles.installer);
  copyFileSync(resolve(root, 'apps/agent/install.sh'), installerPath);
  chmodSync(installerPath, 0o755);

  const sbomBytes = Buffer.from(`${JSON.stringify(parsedSbom, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(output, releaseFiles.sbom), sbomBytes, { mode: 0o644 });

  const manifest = {
    schemaVersion: 1,
    component: 'initpad-agent',
    version,
    source: {
      repository: sourceUrl.toString().replace(/\/$/, ''),
      commit: sourceCommit,
      tag,
    },
    image: {
      name: image,
      digest,
      immutableReference: `${image}@${digest}`,
      platforms: ['linux/amd64', 'linux/arm64'],
      sbom: releaseFiles.sbom,
    },
    installer: {
      file: releaseFiles.installer,
      sha256: sha256(installerBytes),
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(output, releaseFiles.manifest), manifestBytes, { mode: 0o644 });

  const subjects = [
    [releaseFiles.installer, installerBytes],
    [releaseFiles.manifest, manifestBytes],
    [releaseFiles.sbom, sbomBytes],
  ];
  const checksums = `${subjects.map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join('\n')}\n`;
  writeFileSync(resolve(output, releaseFiles.checksums), checksums, { mode: 0o644 });

  return { manifest, files: releaseFiles };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument near ${option || '<end>'}`);
    }
    values[option.slice(2)] = value;
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = prepareAgentRelease({
      outputDirectory: options.output,
      tag: options.tag,
      image: options.image,
      digest: options.digest,
      sourceCommit: options.commit,
      sourceRepository: options.repository,
      sbomPath: options.sbom,
    });
    process.stdout.write(`${result.manifest.image.immutableReference}\n`);
  } catch (error) {
    process.stderr.write(`prepare-agent-release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
