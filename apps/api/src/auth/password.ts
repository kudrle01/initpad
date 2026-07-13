import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Generates a strong one-time password for admin-provisioned accounts and
 * password resets. It satisfies mixed-class complexity checks (upper, lower,
 * digit, symbol) and is long enough that it is only ever shown once before a
 * mandatory change. The plaintext is never persisted — only its scrypt hash.
 */
export function generateTemporaryPassword(): string {
  return `Aa1!${randomBytes(15).toString('base64url')}`;
}

/**
 * Password hashing built on Node's native scrypt (no external dependency).
 * Stored format: "<saltHex>:<hashHex>".
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Verifies a password against the stored hash using a constant-time comparison. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
