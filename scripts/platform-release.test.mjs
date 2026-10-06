import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  assertCleanPublishedMain,
  createPlatformTag,
  preparePlatformVersion,
} from './platform-release.mjs';

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'initpad-platform-version-'));
  write(resolve(root, 'deploy/platform-version.json'), '{\n  "version": "1.2.3"\n}\n');
  write(
    resolve(root, 'apps/supervisor/package.json'),
    '{\n  "name": "@initpad/supervisor",\n  "version": "1.2.3"\n}\n',
  );
  write(
    resolve(root, 'apps/supervisor/src/types.ts'),
    "export const SUPERVISOR_VERSION = '1.2.3';\n",
  );
  write(
    resolve(root, 'apps/supervisor/Dockerfile'),
    'LABEL org.opencontainers.image.version="1.2.3"\n',
  );
  write(
    resolve(root, 'apps/api/src/config.ts'),
    "const version = process.env.INITPAD_PLATFORM_VERSION || '1.2.3';\n",
  );
  write(
    resolve(root, 'deploy/docker-compose.yml'),
    [
      'INITPAD_PLATFORM_VERSION: ${INITPAD_PLATFORM_VERSION:-1.2.3}',
      'INITPAD_PLATFORM_VERSION: ${INITPAD_PLATFORM_VERSION:-1.2.3}',
      'image: gitea/act_runner:0.2.11@sha256:unchanged',
      '',
    ].join('\n'),
  );
  write(resolve(root, 'deploy/.env.example'), 'INITPAD_PLATFORM_VERSION=1.2.3\n');
  write(
    resolve(root, 'package-lock.json'),
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { tinyglobby: '^0.2.11' } },
          'apps/supervisor': { name: '@initpad/supervisor', version: '1.2.3' },
        },
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

test('updates only the platform version fields', () => {
  const root = fixture();
  const result = preparePlatformVersion({ root, nextVersion: '1.2.4' });
  assert.equal(result.currentVersion, '1.2.3');
  assert.equal(result.nextVersion, '1.2.4');
  assert.equal(
    JSON.parse(readFileSync(resolve(root, 'deploy/platform-version.json'))).version,
    '1.2.4',
  );
  assert.equal(
    JSON.parse(readFileSync(resolve(root, 'apps/supervisor/package.json'))).version,
    '1.2.4',
  );
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json')));
  assert.equal(lock.packages['apps/supervisor'].version, '1.2.4');
  assert.equal(lock.packages[''].dependencies.tinyglobby, '^0.2.11');
  assert.match(
    readFileSync(resolve(root, 'deploy/docker-compose.yml'), 'utf8'),
    /gitea\/act_runner:0\.2\.11@sha256:unchanged/,
  );
});

test('rejects a downgrade without changing files', () => {
  const root = fixture();
  const before = readFileSync(resolve(root, 'deploy/platform-version.json'), 'utf8');
  assert.throws(
    () => preparePlatformVersion({ root, nextVersion: '1.2.2' }),
    /must be greater than 1\.2\.3/,
  );
  assert.equal(readFileSync(resolve(root, 'deploy/platform-version.json'), 'utf8'), before);
});

test('refuses an unexpected source layout before writing any file', () => {
  const root = fixture();
  write(
    resolve(root, 'deploy/docker-compose.yml'),
    'INITPAD_PLATFORM_VERSION: ${INITPAD_PLATFORM_VERSION:-1.2.3}\n',
  );
  const before = readFileSync(resolve(root, 'apps/supervisor/package.json'), 'utf8');
  assert.throws(
    () => preparePlatformVersion({ root, nextVersion: '1.2.4' }),
    /expected 2 occurrence/,
  );
  assert.equal(readFileSync(resolve(root, 'apps/supervisor/package.json'), 'utf8'), before);
});

test('requires a clean main branch at the published origin commit', () => {
  const calls = [];
  const git = (_root, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'branch') return 'main';
    if (args[0] === 'status') return '';
    return 'a'.repeat(40);
  };
  assert.equal(assertCleanPublishedMain({ root: '/repo', git }), 'a'.repeat(40));
  assert.deepEqual(calls, [
    'branch --show-current',
    'status --porcelain --untracked-files=all',
    'rev-parse HEAD',
    'rev-parse refs/remotes/origin/main',
  ]);
});

test('creates an annotated tag only for the prepared version', () => {
  const root = fixture();
  preparePlatformVersion({ root, nextVersion: '1.2.4' });
  const calls = [];
  const git = (_root, args) => {
    calls.push(args);
    if (args[0] === 'branch') return 'main';
    if (args[0] === 'status' || args[0] === 'tag') return '';
    return 'b'.repeat(40);
  };
  const result = createPlatformTag({ root, version: '1.2.4', git });
  assert.equal(result.tag, 'initpad-v1.2.4');
  assert.deepEqual(calls.at(-1), ['tag', '-a', 'initpad-v1.2.4', '-m', 'InitPad 1.2.4']);
});
