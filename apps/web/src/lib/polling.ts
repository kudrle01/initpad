export const ACTIVE_HISTORY_POLL_MS = 2_500;
export const IDLE_HISTORY_POLL_MS = 10_000;
export const MAX_POLL_BACKOFF_MS = 60_000;

/**
 * Delay before the next refresh. After failures the interval doubles up to a
 * minute, so a short outage recovers on its own without hammering the API.
 */
export function pollDelay(active: boolean, failures: number): number {
  const base = active ? ACTIVE_HISTORY_POLL_MS : IDLE_HISTORY_POLL_MS;
  if (failures <= 0) return base;
  return Math.min(MAX_POLL_BACKOFF_MS, IDLE_HISTORY_POLL_MS * 2 ** (failures - 1));
}
