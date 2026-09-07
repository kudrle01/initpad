import { environmentExpiry } from './environment-expiry';

describe('environmentExpiry', () => {
  const now = new Date('2026-09-07T10:00:00.000Z');
  const policy = { devTtlHours: 4, testTtlHours: 48 };

  it('sets a warning before the configured dev/test expiry', () => {
    expect(environmentExpiry('dev', policy, now)).toEqual({
      expiresAt: new Date('2026-09-07T14:00:00.000Z'),
      expiryWarningAt: new Date('2026-09-07T13:00:00.000Z'),
    });
    expect(environmentExpiry('test', policy, now)).toEqual({
      expiresAt: new Date('2026-09-09T10:00:00.000Z'),
      expiryWarningAt: new Date('2026-09-08T22:00:00.000Z'),
    });
  });

  it('never assigns an expiry to production', () => {
    expect(environmentExpiry('prod', { devTtlHours: 1, testTtlHours: 1 }, now)).toEqual({
      expiresAt: null,
      expiryWarningAt: null,
    });
  });

  it('keeps non-production workloads when TTL is disabled', () => {
    expect(environmentExpiry('dev', { devTtlHours: null, testTtlHours: null }, now)).toEqual({
      expiresAt: null,
      expiryWarningAt: null,
    });
  });
});
