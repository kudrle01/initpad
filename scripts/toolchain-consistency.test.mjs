import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

// ADR-186: one Node LTS line and one TypeScript for CI, release and images.
const nodeLine = readFileSync('.node-version', 'utf8').trim();
const apps = readdirSync('apps');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const workflows = readdirSync('.github/workflows').map((name) => ({
  name,
  workflow: parse(readFileSync(`.github/workflows/${name}`, 'utf8')),
}));

test('names a single Node major line', () => {
  assert.match(nodeLine, /^\d+$/);
});

test('builds every app image on the Node line', () => {
  for (const app of apps) {
    const images = [
      ...readFileSync(`apps/${app}/Dockerfile`, 'utf8').matchAll(/^FROM \S*\/node:(\d+)-/gm),
    ];
    for (const [, major] of images) assert.equal(major, nodeLine, app);
  }
});

test('runs every workflow on the Node line from .node-version', () => {
  let setups = 0;
  for (const { name, workflow } of workflows) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith('actions/setup-node@')) continue;
        setups += 1;
        assert.equal(step.with['node-version-file'], '.node-version', name);
        assert.equal(step.with['node-version'], undefined, name);
      }
    }
  }
  assert.ok(setups > 0);
});

test('types and engines follow the Node line', () => {
  const root = readJson('package.json');
  assert.match(root.engines.node, new RegExp(`^>=${nodeLine}\\.0\\.0 <${Number(nodeLine) + 1}$`));
  for (const app of apps) {
    const types = readJson(`apps/${app}/package.json`).devDependencies?.['@types/node'];
    if (types) assert.match(types, new RegExp(`^\\^${nodeLine}\\.`), app);
  }
});

test('declares TypeScript once, in the workspace root', () => {
  assert.ok(readJson('package.json').devDependencies.typescript);
  for (const app of apps) {
    const manifest = readJson(`apps/${app}/package.json`);
    assert.equal(manifest.devDependencies?.typescript, undefined, app);
    assert.equal(manifest.dependencies?.typescript, undefined, app);
  }
  const lock = readJson('package-lock.json');
  const copies = Object.keys(lock.packages).filter((path) =>
    path.endsWith('node_modules/typescript'),
  );
  assert.deepEqual(copies, ['node_modules/typescript']);
});
