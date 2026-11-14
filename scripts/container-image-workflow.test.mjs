import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { touchesImageInputs } from './container-image-inputs.mjs';

const workflow = parse(readFileSync('.github/workflows/container-images.yml', 'utf8'));
const autoMerge = parse(readFileSync('.github/workflows/dependabot-auto-merge.yml', 'utf8'));

test('treats dependency manifests, lockfiles and Dockerfiles as image inputs', () => {
  for (const path of [
    'package-lock.json',
    'package.json',
    'apps/api/package.json',
    'apps/supervisor/Dockerfile',
    'templates/express/files/package-lock.json',
    '.node-version',
    '.dockerignore',
  ]) {
    assert.equal(touchesImageInputs([path]), true, path);
  }
  assert.equal(
    touchesImageInputs(['README.md', 'apps/web/src/App.tsx', '.github/workflows/ci.yml']),
    false,
  );
});

test('reports the decision for a changed-file list on stdin', () => {
  const run = (input) =>
    spawnSync(process.execPath, ['scripts/container-image-inputs.mjs'], { input, encoding: 'utf8' })
      .stdout;
  assert.equal(run('docs/adr/README.md\npackage-lock.json\n'), 'true\n');
  assert.equal(run('docs/adr/README.md\n'), 'false\n');
});

test('runs on every pull request so the gate can be a required check', () => {
  assert.equal(workflow.on.pull_request.paths, undefined);
  assert.equal(workflow.on.push.paths, undefined);
  assert.equal(workflow.jobs.build.if, "needs.changes.outputs.images == 'true'");
  const gate = workflow.jobs.gate;
  assert.equal(gate.name, 'Container images');
  assert.equal(gate.if, 'always()');
  assert.deepEqual(gate.needs, ['changes', 'build']);
  assert.match(gate.steps[0].run, /BUILD_RESULT}" == success/);
});

test('auto-merges dependency updates only while image verification is required', () => {
  const steps = autoMerge.jobs['auto-merge'].steps;
  const check = steps.find((step) => step.id === 'images');
  assert.match(check.run, /rules\/branches\/main/);
  assert.match(check.run, /index\("Container images"\)/);
  const merge = steps.find((step) => step.run?.includes('gh pr merge --auto'));
  assert.match(merge.if, /steps\.images\.outputs\.required == 'true'/);
  assert.match(merge.if, /version-update:semver-patch/);
  assert.doesNotMatch(merge.if, /semver-major/);
});
