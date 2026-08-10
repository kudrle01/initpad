import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('preserves result order while bounding active work', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];

    const result = mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    });

    await Promise.resolve();
    expect(active).toBe(2);
    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }

    await expect(result).resolves.toEqual([10, 20, 30, 40, 50]);
    expect(maximum).toBe(2);
  });

  it('rejects an invalid concurrency limit', async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      'positive integer',
    );
  });
});
