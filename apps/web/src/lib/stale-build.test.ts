// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForNewBuild } from './stale-build';

afterEach(() => sessionStorage.clear());

describe('stale build recovery', () => {
  it('recognises the chunk failure of every major browser', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/Dashboard-Bfodxi2V.js',
      'error loading dynamically imported module: https://x/assets/a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/index.css',
    ]) {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
    expect(isChunkLoadError(new Error('Project not found'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('reloads once, then leaves a repeated failure to the user', () => {
    const reload = vi.fn();

    expect(reloadForNewBuild(100_000, reload)).toBe(true);
    // The new build failed too: no reload loop.
    expect(reloadForNewBuild(103_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // A later release may reload again.
    expect(reloadForNewBuild(200_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
