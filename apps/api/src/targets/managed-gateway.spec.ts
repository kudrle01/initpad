import {
  managedGatewayOrigin,
  normalizeManagedGatewayOrigin,
  stableGatewayHostname,
} from './managed-gateway';

describe('managed gateway DNS identity (ADR-073)', () => {
  it('canonicalizes a clean HTTPS DNS origin', () => {
    expect(normalizeManagedGatewayOrigin('https://Apps.Example.Test/')).toBe(
      'https://apps.example.test',
    );
  });

  it.each([
    'http://apps.example.test',
    'https://192.0.2.10',
    'https://apps.example.test:8443',
    'https://apps.example.test/path',
    'https://user:secret@apps.example.test',
    'https://apps_example.test',
  ])('rejects a non-production gateway origin: %s', (value) => {
    expect(() => normalizeManagedGatewayOrigin(value)).toThrow('HTTPS DNS origin');
  });

  it('allows only the target zone or one of its sub-zones', () => {
    expect(
      managedGatewayOrigin('https://apps.example.test', 'https://team-alpha.apps.example.test'),
    ).toBe('https://team-alpha.apps.example.test');
    expect(() =>
      managedGatewayOrigin('https://apps.example.test', 'https://attacker.example.test'),
    ).toThrow('inside the target DNS zone');
  });

  it('creates a readable stable hostname from the immutable environment id', () => {
    const first = stableGatewayHostname(
      'Customer Portal',
      'dev',
      'environment-immutable-id',
      'https://apps.example.test',
    );
    const renamed = stableGatewayHostname(
      'Renamed Portal',
      'dev',
      'environment-immutable-id',
      'https://apps.example.test',
    );
    const other = stableGatewayHostname(
      'Customer Portal',
      'dev',
      'other-environment-id',
      'https://apps.example.test',
    );

    expect(first).toMatch(/^customer-portal-dev-[a-f0-9]{12}\.apps\.example\.test$/);
    expect(renamed).not.toBe(first);
    expect(other).not.toBe(first);
    expect(first.split('.')[0]!.length).toBeLessThanOrEqual(63);
  });
});
