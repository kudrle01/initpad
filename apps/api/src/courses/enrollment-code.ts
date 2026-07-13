import { randomBytes } from 'crypto';
import { hashToken } from '../common/token';

export function normalizeEnrollmentCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hashEnrollmentCode(value: string): string {
  return hashToken(normalizeEnrollmentCode(value));
}

export function generateEnrollmentCode(): string {
  const body = randomBytes(8).toString('hex').toUpperCase();
  return `INIT-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}`;
}
