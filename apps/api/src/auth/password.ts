import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// Hashování hesla pomocí scrypt (bez externí závislosti).
// Formát: "<saltHex>:<hashHex>".
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
