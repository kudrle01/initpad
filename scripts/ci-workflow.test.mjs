import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const readWorkflow = (name) => parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
const ci = readWorkflow('ci.yml');
const ciSteps = ci.jobs.check.steps;
const packageScripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const stepRunning = (command) => ciSteps.find((step) => step.run?.trim() === command);

test('gates pull requests on the deterministic offline check only', () => {
  assert.ok(ci.on.pull_request);
  assert.equal(ci.jobs.check.name, 'Build, test and audit');
  for (const command of ['npm run check', 'npm run check:compose']) {
    const step = stepRunning(command);
    assert.ok(step, command);
    assert.equal(step.if, undefined, command);
  }
  assert.equal(stepRunning('npm run check:release'), undefined);
});

test('audits dependencies on main and on schedule, never on a pull request', () => {
  assert.ok(ci.on.schedule?.length);
  assert.deepEqual(ci.on.push.branches, ['main']);
  const audit = stepRunning('npm run audit:dependencies');
  assert.ok(audit);
  assert.equal(audit.if, "github.event_name != 'pull_request'");
});

test('installs age from the pinned action instead of apt', () => {
  for (const name of readdirSync('.github/workflows')) {
    const source = readFileSync(`.github/workflows/${name}`, 'utf8');
    assert.ok(!/apt-get install[^\n]*\bage\b/.test(source), `${name} installs age with apt`);
  }
  assert.ok(ciSteps.some((step) => step.uses === './.github/actions/setup-age'));
  const action = parse(readFileSync('.github/actions/setup-age/action.yml', 'utf8'));
  const { env } = action.runs.steps[0];
  assert.match(env.AGE_VERSION, /^v\d+\.\d+\.\d+$/);
  assert.match(env.AGE_SHA256, /^[0-9a-f]{64}$/);
  assert.match(action.runs.steps[0].run, /sha256sum --check/);
});

test('check:compose renders every profile with the CI environment and cleans up', () => {
  assert.equal(packageScripts['check:compose'], 'node scripts/check-compose.mjs');
  const work = mkdtempSync(join(tmpdir(), 'initpad-check-compose-'));
  const log = join(work, 'docker.log');
  const fakeDocker = join(work, 'docker');
  writeFileSync(
    fakeDocker,
    [
      '#!/usr/bin/env bash',
      'override=.runtime/platform-update/platform-release.override.yml',
      'printf "%s|%s|%s|%s\\n" "$PWD" "$*" "$INITPAD_INSTALL_ROOT" "$(cat "$override")" >> "$FAKE_DOCKER_LOG"',
      'test -n "$INITPAD_SUPERVISOR_SHARED_SECRET"',
    ].join('\n'),
  );
  chmodSync(fakeDocker, 0o755);
  const override = 'deploy/.runtime/platform-update/platform-release.override.yml';
  const hadOverride = existsSync(override);

  const result = spawnSync(process.execPath, ['scripts/check-compose.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH}`, FAKE_DOCKER_LOG: log },
  });

  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split('|'));
  assert.deepEqual(
    calls.map(([, args]) => args),
    [
      'compose --env-file .env.example config --quiet',
      'compose --env-file .env.example --profile runner config --quiet',
      'compose --env-file .env.example --profile server config --quiet',
    ],
  );
  for (const [cwd, , installRoot, overrideContent] of calls) {
    assert.equal(cwd, join(process.cwd(), 'deploy'));
    assert.equal(installRoot, process.cwd());
    if (!hadOverride) assert.equal(overrideContent, 'services: {}');
  }
  assert.equal(existsSync(override), hadOverride);
});

test('check:compose fails when Compose rejects the configuration', () => {
  const work = mkdtempSync(join(tmpdir(), 'initpad-check-compose-'));
  writeFileSync(join(work, 'docker'), '#!/usr/bin/env bash\nexit 15\n');
  chmodSync(join(work, 'docker'), 0o755);
  const result = spawnSync(process.execPath, ['scripts/check-compose.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${work}${delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 15);
  assert.match(result.stderr, /check:compose: docker compose .* failed/);
});
