/**
 * Unsent form input kept for this browser tab, so a detour to add a server
 * from the new-project or import form does not lose what was filled in.
 */
const PREFIX = 'initpad.draft.';

export function readDraft<T>(key: string): Partial<T> | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; the form still works without a draft.
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to clear.
  }
}

/** Opens the add-server dialog and comes back to `returnTo` after saving. */
export function addServerHref(returnTo: string): string {
  return `/infrastructure?add=1&returnTo=${encodeURIComponent(returnTo)}`;
}

/** Accepts only an in-app path, so the parameter cannot redirect elsewhere. */
export function safeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null;
  return value;
}
