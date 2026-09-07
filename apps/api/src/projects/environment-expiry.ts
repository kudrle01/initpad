import type { EnvName } from '../domain/types';

export interface EnvironmentTtlPolicy {
  devTtlHours: number | null;
  testTtlHours: number | null;
}

/** Dates persisted after a successful deploy. Production is deliberately exempt. */
export function environmentExpiry(
  environment: EnvName | string,
  allocation: EnvironmentTtlPolicy | null | undefined,
  now = new Date(),
): { expiresAt: Date | null; expiryWarningAt: Date | null } {
  const ttlHours = environment === 'dev'
    ? allocation?.devTtlHours
    : environment === 'test'
      ? allocation?.testTtlHours
      : null;
  if (!ttlHours) return { expiresAt: null, expiryWarningAt: null };
  const ttlMs = ttlHours * 60 * 60 * 1_000;
  const warningLeadMs = Math.min(24 * 60 * 60 * 1_000, Math.floor(ttlMs / 4));
  const expiresAt = new Date(now.getTime() + ttlMs);
  return {
    expiresAt,
    expiryWarningAt: new Date(expiresAt.getTime() - warningLeadMs),
  };
}
