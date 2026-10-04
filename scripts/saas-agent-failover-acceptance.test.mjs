import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const probePath = resolve('apps/api/scripts/saas-agent-failover-probe.js');
const {
  assertRecoveredState,
  boundedInteger,
  fixtureUsername,
  parseCommand,
  projectIdentity,
  publicOrigin,
} = require(probePath);
const marker = '123e4567-e89b-42d3-a456-426614174000';
const operation = '223e4567-e89b-42d3-a456-426614174000';

test('accepts only the fixed two-phase Agent failover protocol', () => {
  assert.deepEqual(parseCommand(['before', marker]), {
    command: 'before',
    marker,
    operationId: undefined,
  });
  assert.deepEqual(parseCommand(['after', marker, operation]), {
    command: 'after',
    marker,
    operationId: operation,
  });
  assert.deepEqual(parseCommand(['cleanup', marker]), {
    command: 'cleanup',
    marker,
    operationId: undefined,
  });
  assert.throws(() => parseCommand(['after', marker, 'invalid']), /must be a UUID v4/);
  assert.throws(() => parseCommand(['before', marker, operation]), /does not accept/);
  assert.throws(() => parseCommand(['shell', marker]), /Expected before/);
});

test('bounds the disposable project, environment, URL and timeout', () => {
  assert.deepEqual(
    projectIdentity({
      INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID: marker,
      INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT: 'test',
    }),
    { projectId: marker, environmentName: 'test' },
  );
  assert.throws(
    () =>
      projectIdentity({
        INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID: marker,
        INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT: 'prod',
      }),
    /must be dev or test/,
  );
  assert.equal(
    publicOrigin({ INITPAD_MUTATION_ACCEPTANCE_URL: 'https://staging.example.test' }),
    'https://staging.example.test',
  );
  assert.throws(
    () => publicOrigin({ INITPAD_MUTATION_ACCEPTANCE_URL: 'http://staging.example.test' }),
    /clean public HTTPS origin/,
  );
  assert.equal(boundedInteger('TIMEOUT', 300, 60, 900, { TIMEOUT: '600' }), 600);
  assert.throws(() => boundedInteger('TIMEOUT', 300, 60, 900, { TIMEOUT: '901' }), /60 to 900/);
  assert.equal(fixtureUsername(marker), 'agent-failover-123e4567e89b42d3a456426614174000');
});

test('requires one terminal Agent job chain with no duplicate operation or live lock', () => {
  const valid = {
    scopeMatches: true,
    operationStatus: 'succeeded',
    operationFinished: true,
    environmentStatus: 'running',
    activeOperationId: null,
    deploymentRequired: false,
    versionMatches: true,
    artifactMatches: true,
    duplicateOperations: 0,
    auditSucceeded: true,
    jobCount: 2,
    expectedJobCount: 2,
    deployJobs: 1,
    routeJobs: 1,
    jobsTerminal: true,
    jobStepsUnique: true,
    jobLeasesCleared: true,
  };
  assert.deepEqual(assertRecoveredState(valid), []);
  for (const [key, value] of [
    ['scopeMatches', false],
    ['operationStatus', 'failed'],
    ['activeOperationId', operation],
    ['duplicateOperations', 1],
    ['auditSucceeded', false],
    ['jobsTerminal', false],
    ['jobStepsUnique', false],
    ['jobLeasesCleared', false],
  ]) {
    assert.ok(assertRecoveredState({ ...valid, [key]: value }).length > 0, key);
  }
});

test('rejects malformed input before loading Prisma or opening a database', () => {
  const result = spawnSync(process.execPath, [probePath, 'after', marker, 'invalid'], {
    encoding: 'utf8',
    env: { INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Deployment operation must be a UUID v4/);
  assert.doesNotMatch(result.stderr, /Prisma|postgresql:|credential/i);
});
