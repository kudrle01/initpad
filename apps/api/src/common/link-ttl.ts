/**
 * Lifetimes of the single-use links InitPad sends by e-mail. Shared by the
 * services that issue the links and the mail templates that state the expiry,
 * so the promise in the message always matches the token in the database.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const EMAIL_VERIFY_TTL_MS = DAY_MS;
export const PASSWORD_RESET_TTL_MS = HOUR_MS;
export const ACTIVATION_TTL_MS = 3 * DAY_MS;
export const INVITATION_TTL_MS = 7 * DAY_MS;

/** "1 hour", "24 hours", "3 days" – whole hours below two days, days above. */
export function describeTtl(ms: number): string {
  if (ms >= 2 * DAY_MS && ms % DAY_MS === 0) return plural(ms / DAY_MS, 'day');
  return plural(Math.max(1, Math.round(ms / HOUR_MS)), 'hour');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
