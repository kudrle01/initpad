import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findStaleDocuments, latestStable, requiredMentions } from './docs-freshness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('picks the newest stable release by semantic version', () => {
  const releases = [
    { tag_name: 'initpad-v0.2.9', draft: false, prerelease: false },
    { tag_name: 'initpad-v0.2.23', draft: false, prerelease: false },
    { tag_name: 'initpad-v0.3.0', draft: false, prerelease: true },
    { tag_name: 'initpad-v0.4.0', draft: true, prerelease: false },
    { tag_name: 'agent-v0.14.3', draft: false, prerelease: false },
  ];
  assert.equal(latestStable(releases, 'initpad-v'), '0.2.23');
  assert.equal(latestStable(releases, 'agent-v'), '0.14.3');
  assert.equal(latestStable([], 'agent-v'), null);
});

test('reports every document that still names an older release', () => {
  const docs = { 'README.md': '', 'docs/RELEASE_READINESS.md': '' };
  const stale = findStaleDocuments({
    read: (path) => docs[path] ?? '',
    platform: '9.9.9',
    agent: '8.8.8',
  });
  const expected = Object.values(requiredMentions({ platform: '9.9.9', agent: '8.8.8' })).flat();
  assert.equal(stale.length, expected.length);
  assert.ok(stale.some((line) => line.includes('initpad-v9.9.9')));
});

test('the documents can name a version through the required mentions', () => {
  // Guards the mention patterns themselves: a pattern that no document can
  // satisfy would turn the weekly check into permanent noise.
  const platform = /--tag initpad-v(\d+\.\d+\.\d+)\n(?![\s\S]*--tag initpad-v)/.exec(
    read('README.md'),
  )?.[1];
  const agent = /^INITPAD_AGENT_RELEASE_VERSION=(\S+)$/m.exec(
    read('deploy/agent-release.env'),
  )?.[1];
  assert.ok(platform && agent);
  assert.deepEqual(findStaleDocuments({ read, platform, agent }), []);
});
