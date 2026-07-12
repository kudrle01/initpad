import test from 'node:test';
import assert from 'node:assert/strict';
import { healthPayload } from '../app/lib/status.mjs';

test('health payload reports ok', () => {
  assert.deepEqual(healthPayload(), { status: 'ok' });
});
