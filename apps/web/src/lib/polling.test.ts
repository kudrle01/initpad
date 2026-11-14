import { describe, expect, it } from 'vitest';
import { MAX_POLL_BACKOFF_MS, pollDelay } from './polling';

describe('deployment history polling', () => {
  it('polls quickly while an operation runs and slowly when idle', () => {
    expect(pollDelay(true, 0)).toBeLessThan(pollDelay(false, 0));
  });

  it('backs off after failures instead of stopping, up to a minute', () => {
    const delays = [1, 2, 3, 4, 5, 10].map((failures) => pollDelay(true, failures));
    expect(delays[0]).toBeGreaterThanOrEqual(pollDelay(false, 0));
    for (let index = 1; index < delays.length; index++) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]);
    }
    expect(delays.at(-1)).toBe(MAX_POLL_BACKOFF_MS);
  });
});
