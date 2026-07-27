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
