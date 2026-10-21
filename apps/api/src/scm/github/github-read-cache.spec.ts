import { ReadCache } from './github-read-cache';

describe('ReadCache', () => {
  it('expires entries after the time-to-live', () => {
    let now = 1000;
    const cache = new ReadCache<string>(10, 100, () => now);
    cache.set('a', 'x');
    expect(cache.get('a')).toBe('x');
    now += 100;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry beyond its bound', () => {
    const cache = new ReadCache<number>(2, 1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('deletes entries by key prefix', () => {
    const cache = new ReadCache<number>(10, 1000);
    cache.set('acme/api|1', 1);
    cache.set('acme/api|2', 2);
    cache.set('acme/web|1', 3);
    cache.deleteByPrefix('acme/api|');
    expect(cache.get('acme/api|1')).toBeUndefined();
    expect(cache.get('acme/web|1')).toBe(3);
  });
});
