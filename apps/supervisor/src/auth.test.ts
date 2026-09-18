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
      { timestamp, requestId, signature: signRequest(secret, timestamp, requestId, body), body },
      now,
    ),
  );
});

test('rejects tampered, expired and weakly configured requests', () => {
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const timestamp = String(now);
  const body = Buffer.from('{}');
  const signature = signRequest(secret, timestamp, requestId, body);
  assert.throws(
    () =>
      authenticateRequest(secret, { timestamp, requestId, signature, body: Buffer.from('x') }, now),
    /signature is invalid/,
  );
  assert.throws(
    () => authenticateRequest(secret, { timestamp, requestId, signature, body }, now + 60_001),
    /outside the allowed window/,
  );
  assert.throws(
    () => authenticateRequest('weak', { timestamp, requestId, signature, body }, now),
    /not configured safely/,
  );
});
