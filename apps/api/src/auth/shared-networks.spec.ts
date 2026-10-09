import { inSharedNetwork, parseSharedNetworks } from './shared-networks';

describe('shared networks (ADR-149)', () => {
  it('matches IPv4, IPv4-mapped and IPv6 clients inside the configured ranges', () => {
    const networks = parseSharedNetworks(['198.51.100.0/24', '2001:db8:10::/48']);
    expect(inSharedNetwork(networks, '198.51.100.200')).toBe(true);
    expect(inSharedNetwork(networks, '::ffff:198.51.100.1')).toBe(true);
    expect(inSharedNetwork(networks, '2001:db8:10:ffff::1')).toBe(true);
    expect(inSharedNetwork(networks, '198.51.101.1')).toBe(false);
    expect(inSharedNetwork(networks, 'unknown')).toBe(false);
  });

  it('rejects malformed or implausibly wide ranges', () => {
    for (const value of [
      '198.51.100.0',
      '198.51.100.0/33',
      '0.0.0.0/0',
      '10.0.0.0/4',
      'school/24',
      '::/0',
    ]) {
      expect(() => parseSharedNetworks([value])).toThrow('INITPAD_RATE_LIMIT_SHARED_NETWORKS');
    }
  });
});
