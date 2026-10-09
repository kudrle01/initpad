import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[a-f0-9]{64}$/;

export function bodyDigest(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Signature v2 (ADR-146) binds the HTTP method and path as well as the time,
 * request id and body, so a signed status read cannot authorize an update.
 */
export function signRequest(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  requestId: string,
  body: Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`v2\n${method}\n${path}\n${timestamp}\n${requestId}\n${bodyDigest(body)}`)
    .digest('hex');
}

export function authenticateRequest(
  secret: string,
  input: {
    method: string;
    path: string;
    timestamp?: string;
    requestId?: string;
    signature?: string;
    body: Buffer;
  },
  now = Date.now(),
): void {
  if (secret.length < 32) throw new Error('Supervisor shared secret is not configured safely');
  if (!input.timestamp || !/^\d{10,13}$/.test(input.timestamp)) {
    throw new Error('Supervisor request timestamp is invalid');
  }
  const timestamp = Number(input.timestamp);
  const milliseconds = input.timestamp.length === 10 ? timestamp * 1_000 : timestamp;
  if (!Number.isSafeInteger(milliseconds) || Math.abs(now - milliseconds) > 60_000) {
    throw new Error('Supervisor request timestamp is outside the allowed window');
  }
  if (!input.requestId || !UUID.test(input.requestId)) {
    throw new Error('Supervisor request id is invalid');
  }
  if (!input.signature || !SIGNATURE.test(input.signature)) {
    throw new Error('Supervisor request signature is invalid');
  }
  const expected = signRequest(
    secret,
    input.method,
    input.path,
    input.timestamp,
    input.requestId,
    input.body,
  );
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(input.signature, 'hex'))) {
    throw new Error('Supervisor request signature is invalid');
  }
}
