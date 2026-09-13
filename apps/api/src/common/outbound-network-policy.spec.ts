import {
  boundedHttpGet,
  isPublicInternetAddress,
  resolvePublicInternetHost,
  UnsafeOutboundDestinationError,
  type HostResolver,
} from './outbound-network-policy';

describe('hosted outbound network policy', () => {
  it('accepts ordinary public IPv4 and IPv6 addresses', () => {
    expect(isPublicInternetAddress('8.8.8.8')).toBe(true);
    expect(isPublicInternetAddress('2606:4700:4700::1111')).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1',
    '2001:db8::1',
    '2002:a00:1::',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'fe80::1%en0',
    'ff02::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicInternetAddress(address)).toBe(false);
  });

  it('rejects a mixed DNS answer instead of selecting its public record', async () => {
    const resolver: HostResolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.20', family: 4 },
    ];

    await expect(resolvePublicInternetHost('target.example', resolver)).rejects.toBeInstanceOf(
      UnsafeOutboundDestinationError,
    );
  });

  it('returns one pinned address only after every DNS answer passes', async () => {
    const resolver: HostResolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ];

    await expect(resolvePublicInternetHost('target.example', resolver)).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });
  });

  it('bounds a resolver that never completes', async () => {
    const resolver: HostResolver = () => new Promise<never>(() => undefined);

    await expect(resolvePublicInternetHost('target.example', resolver, 5)).rejects.toThrow(
      'DNS lookup timed out',
    );
  });

  it('rejects private and non-HTTP probe destinations before opening a socket', async () => {
    await expect(
      boundedHttpGet('http://127.0.0.1/private', { publicInternetOnly: true }),
    ).rejects.toBeInstanceOf(UnsafeOutboundDestinationError);
    await expect(
      boundedHttpGet('ftp://8.8.8.8/file', { publicInternetOnly: true }),
    ).rejects.toBeInstanceOf(UnsafeOutboundDestinationError);
  });
});
