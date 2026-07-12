import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenMatches(token: string, expectedHash: string | null | undefined): boolean {
  if (!token || !expectedHash || !/^[0-9a-f]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
