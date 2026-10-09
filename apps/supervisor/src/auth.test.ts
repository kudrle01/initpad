import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateRequest, signRequest } from './auth.js';

const secret = 's'.repeat(48);
const requestId = '3f04ebec-3299-4ce5-bd02-cf390ca413e9';

test('accepts an intact, recent HMAC request', () => {
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const timestamp = String(now);
  const body = Buffer.from('{"update":true}');
  assert.doesNotThrow(() =>
    authenticateRequest(
      secret,
      {
        method: 'POST',
        path: '/v1/update',
        timestamp,
        requestId,
        signature: signRequest(secret, 'POST', '/v1/update', timestamp, requestId, body),
        body,
      },
      now,
    ),
  );
});

test('rejects tampered, expired and weakly configured requests', () => {
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const timestamp = String(now);
  const body = Buffer.from('{}');
  const signed = { method: 'GET', path: '/v1/status', timestamp, requestId, body };
  const signature = signRequest(secret, 'GET', '/v1/status', timestamp, requestId, body);
  const valid = { ...signed, signature };
  assert.doesNotThrow(() => authenticateRequest(secret, valid, now));
  assert.throws(
    () => authenticateRequest(secret, { ...valid, body: Buffer.from('x') }, now),
    /signature is invalid/,
  );
  // A signed status read cannot be replayed as an update.
  assert.throws(
    () => authenticateRequest(secret, { ...valid, method: 'POST', path: '/v1/update' }, now),
    /signature is invalid/,
  );
  assert.throws(
    () => authenticateRequest(secret, valid, now + 60_001),
    /outside the allowed window/,
  );
  assert.throws(() => authenticateRequest('weak', valid, now), /not configured safely/);
});
