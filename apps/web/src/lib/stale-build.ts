// After a release replaces the web bundle, a tab opened before it still asks
// for the previous build's hashed chunks, which no longer exist. Browsers word
// that failure differently; all of them mean "reload to get the new build".
const CHUNK_LOAD_ERROR = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite CSS preload
];

const STORAGE_KEY = 'initpad.staleBuildReloadAt';
// One automatic reload per window: if the new build fails as well, the page
// shows the error instead of reloading forever.
const RELOAD_WINDOW_MS = 10_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_LOAD_ERROR.some((pattern) => pattern.test(message));
}

function readStamp(): number {
  try {
    return Number(sessionStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Reloads once to pick up the new build. Returns false when a reload already
 * happened moments ago (or storage is unavailable to prove it did not), so the
 * caller can show the error with a manual Reload button instead.
 */
export function reloadForNewBuild(now = Date.now(), reload = () => window.location.reload()) {
  if (now - readStamp() < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/** Vite reports a failed chunk or CSS preload with this event (ADR-169). */
export function installStaleBuildRecovery(target: Window = window) {
  target.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
