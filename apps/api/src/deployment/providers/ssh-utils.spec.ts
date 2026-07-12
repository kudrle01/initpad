import { portSlot } from './ssh-utils';

describe('portSlot', () => {
  it('is within [0, slots)', () => {
    for (const key of ['a-dev', 'b-test', 'c-prod', 'my-project-prod']) {
      const slot = portSlot(key, 100);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(100);
    }
  });

  it('is deterministic for the same key', () => {
    expect(portSlot('proj-dev', 50)).toBe(portSlot('proj-dev', 50));
  });
});
