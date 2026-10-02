import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { boundedInteger, boundedNumber, evaluateLoadResult, percentile, publicOrigin } = require(
  resolve('apps/api/scripts/saas-load-probe.js'),
);

test('parses only bounded load-test parameters and a clean HTTPS origin', () => {
  assert.equal(boundedInteger('COUNT', 10, 1, 20, { COUNT: '12' }), 12);
  assert.equal(boundedNumber('RATE', 0.01, 0, 0.2, { RATE: '0.02' }), 0.02);
  assert.throws(() => boundedInteger('COUNT', 10, 1, 20, { COUNT: '2.5' }), /integer/);
  assert.throws(() => boundedNumber('RATE', 0.01, 0, 0.2, { RATE: '1' }), /number/);
  assert.equal(
    publicOrigin({ INITPAD_LOAD_ACCEPTANCE_URL: 'https://initpad.example/' }),
    'https://initpad.example',
  );
  assert.throws(
    () => publicOrigin({ INITPAD_LOAD_ACCEPTANCE_URL: 'http://initpad.example' }),
    /public HTTPS origin/,
  );
  assert.throws(
    () => publicOrigin({ INITPAD_LOAD_ACCEPTANCE_URL: 'https://user:x@example.test' }),
    /public HTTPS origin/,
  );
  assert.throws(
    () => publicOrigin({ INITPAD_LOAD_ACCEPTANCE_URL: 'https://initpad.example/path' }),
    /public HTTPS origin/,
  );
});

test('calculates deterministic nearest-rank latency percentiles', () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([9, 1, 5, 3, 7], 0.5), 5);
  assert.equal(percentile([9, 1, 5, 3, 7], 0.95), 9);
});

test('requires volume, latency, reliability and more than one answering replica', () => {
  const thresholds = {
    minimumRequests: 300,
    maximumErrorRate: 0.01,
    maximumP95Ms: 1_000,
    minimumInstances: 2,
  };
  assert.deepEqual(
    evaluateLoadResult({ requests: 400, errorRate: 0.005, p95Ms: 500, instances: 2 }, thresholds),
    [],
  );
  const failures = evaluateLoadResult(
    { requests: 100, errorRate: 0.02, p95Ms: 1_500, instances: 1 },
    thresholds,
  );
  assert.equal(failures.length, 4);
});
