#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const versionedFiles = [
  'deploy/platform-version.json',
  'apps/supervisor/package.json',
  'apps/supervisor/src/types.ts',
  'apps/supervisor/Dockerfile',
  'apps/api/src/config.ts',
  'deploy/docker-compose.yml',
  'deploy/.env.example',
  'package-lock.json',
];

function parseVersion(value, label = 'version') {
  const match = STABLE_VERSION.exec(value ?? '');
  if (!match) throw new Error(`${label} must be a stable semantic version`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function replaceExactly(source, search, replacement, expectedCount, path) {
  const count = source.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `${path}: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
    );
  }
  return source.split(search).join(replacement);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultGit(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function assertCleanPublishedMain({ root = repositoryRoot, git = defaultGit } = {}) {
  const branch = git(root, ['branch', '--show-current']);
  if (branch !== 'main')
    throw new Error(`release must be prepared from main, current branch is ${branch}`);

  const status = git(root, ['status', '--porcelain', '--untracked-files=all']);
  if (status) throw new Error('working tree must be clean before preparing or tagging a release');

  const head = git(root, ['rev-parse', 'HEAD']);
  let originMain;
  try {
    originMain = git(root, ['rev-parse', 'refs/remotes/origin/main']);
  } catch {
    throw new Error('origin/main is unavailable; run git fetch origin main');
  }
  if (head !== originMain) {
    throw new Error('HEAD must equal origin/main; pull or push main before continuing');
  }
  return head;
}

export function currentPlatformVersion(root = repositoryRoot) {
  const manifest = readJson(resolve(root, 'deploy/platform-version.json'));
  parseVersion(manifest.version, 'current platform version');
  return manifest.version;
}

export function preparePlatformVersion({ root = repositoryRoot, nextVersion }) {
  const nextParts = parseVersion(nextVersion, 'new platform version');
  const currentVersion = currentPlatformVersion(root);
  const currentParts = parseVersion(currentVersion, 'current platform version');
  if (compareVersions(nextParts, currentParts) <= 0) {
    throw new Error(`new platform version ${nextVersion} must be greater than ${currentVersion}`);
  }

  const paths = Object.fromEntries(versionedFiles.map((path) => [path, resolve(root, path)]));
  const platformManifest = readJson(paths['deploy/platform-version.json']);
  const supervisorPackage = readJson(paths['apps/supervisor/package.json']);
  const packageLock = readJson(paths['package-lock.json']);
  if (supervisorPackage.version !== currentVersion) {
    throw new Error('Supervisor package version does not match the current platform version');
  }
  if (packageLock.packages?.['apps/supervisor']?.version !== currentVersion) {
    throw new Error('Supervisor package-lock entry does not match the current platform version');
  }

  platformManifest.version = nextVersion;
  supervisorPackage.version = nextVersion;
  packageLock.packages['apps/supervisor'].version = nextVersion;

  const updates = new Map([
    ['deploy/platform-version.json', jsonBytes(platformManifest)],
    ['apps/supervisor/package.json', jsonBytes(supervisorPackage)],
    ['package-lock.json', jsonBytes(packageLock)],
  ]);

  const replacements = [
    [
      'apps/supervisor/src/types.ts',
      `SUPERVISOR_VERSION = '${currentVersion}'`,
      `SUPERVISOR_VERSION = '${nextVersion}'`,
      1,
    ],
    [
      'apps/supervisor/Dockerfile',
      `org.opencontainers.image.version="${currentVersion}"`,
      `org.opencontainers.image.version="${nextVersion}"`,
      1,
    ],
    [
      'apps/api/src/config.ts',
      `INITPAD_PLATFORM_VERSION || '${currentVersion}'`,
      `INITPAD_PLATFORM_VERSION || '${nextVersion}'`,
      1,
    ],
    [
      'deploy/docker-compose.yml',
      `INITPAD_PLATFORM_VERSION:-${currentVersion}`,
      `INITPAD_PLATFORM_VERSION:-${nextVersion}`,
      2,
    ],
    [
      'deploy/.env.example',
      `INITPAD_PLATFORM_VERSION=${currentVersion}`,
      `INITPAD_PLATFORM_VERSION=${nextVersion}`,
      1,
    ],
  ];
  for (const [path, search, replacement, count] of replacements) {
    updates.set(
      path,
      replaceExactly(readFileSync(paths[path], 'utf8'), search, replacement, count, path),
    );
  }

  // Validate every expected edit before writing any file. This avoids a half-bumped release.
  for (const [path, bytes] of updates) writeFileSync(paths[path], bytes);
  return { currentVersion, nextVersion, files: [...updates.keys()] };
}

export function createPlatformTag({ root = repositoryRoot, version, git = defaultGit } = {}) {
  parseVersion(version, 'platform tag version');
  const currentVersion = currentPlatformVersion(root);
  if (version !== currentVersion) {
    throw new Error(`tag version ${version} does not match platform version ${currentVersion}`);
  }
  const commit = assertCleanPublishedMain({ root, git });
  const tag = `initpad-v${version}`;
  const existing = git(root, ['tag', '--list', tag]);
  if (existing) throw new Error(`tag ${tag} already exists locally`);
  git(root, ['tag', '-a', tag, '-m', `InitPad ${version}`]);
  return { tag, commit };
}

function runReleaseGate(root) {
  execFileSync('npm', ['run', 'check:release'], { cwd: root, stdio: 'inherit' });
  execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'inherit' });
}

function usage() {
  return [
    'Usage:',
    '  npm run release:platform:prepare -- <version>',
    '  npm run release:platform:tag -- <version>',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, version, ...extra] = process.argv.slice(2);
    if (!command || !version || extra.length > 0 || !['prepare', 'tag'].includes(command)) {
      throw new Error(usage());
    }

    if (command === 'prepare') {
      assertCleanPublishedMain();
      const result = preparePlatformVersion({ nextVersion: version });
      process.stdout.write(
        `Prepared InitPad ${result.currentVersion} -> ${result.nextVersion}. Running the release gate.\n`,
      );
      runReleaseGate(repositoryRoot);
      process.stdout.write(
        [
          `InitPad ${version} is ready for review.`,
          'Review git diff, then commit and push main.',
          `After the main workflow is green, run: npm run release:platform:tag -- ${version}`,
          '',
        ].join('\n'),
      );
    } else {
      const result = createPlatformTag({ version });
      process.stdout.write(
        `Created ${result.tag} at ${result.commit}. Push it with: git push origin ${result.tag}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `platform-release: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
