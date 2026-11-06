import { allocationUsageDefaults } from './target-allocation-defaults';

describe('allocationUsageDefaults (ADR-060)', () => {
  const builtIn = {
    scope: 'builtin',
    remotePath: '/srv/www/',
    publicUrl: 'https://apps.example.test/',
  };

  it('adds a workspace prefix for a new shared built-in allocation', () => {
    expect(allocationUsageDefaults(builtIn, 'team-alpha')).toEqual({
      rootPath: '/srv/www/team-alpha',
      publicUrl: 'https://apps.example.test/team-alpha',
    });
  });

  it('strips any run of trailing slashes in linear time', () => {
    expect(
      allocationUsageDefaults({ ...builtIn, remotePath: '/srv/www///' }, 'team-alpha').rootPath,
    ).toBe('/srv/www/team-alpha');
    expect(allocationUsageDefaults({ ...builtIn, remotePath: '///' }, 'team-alpha').rootPath).toBe(
      '/team-alpha',
    );
    const started = Date.now();
    allocationUsageDefaults({ ...builtIn, remotePath: `${'/'.repeat(100_000)}x` }, 'team-alpha');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('preserves exact paths for legacy backfill', () => {
    expect(allocationUsageDefaults(builtIn, 'team-alpha', true)).toEqual({
      rootPath: '/srv/www/',
      publicUrl: 'https://apps.example.test/',
    });
  });

  it('does not add a second namespace to a workspace-owned target', () => {
    expect(
      allocationUsageDefaults(
        { scope: 'user', remotePath: '/home/team', publicUrl: 'https://team.example' },
        'team-alpha',
      ),
    ).toEqual({
      rootPath: '/home/team',
      publicUrl: 'https://team.example',
    });
  });
});
