import { SshProvider } from './ssh.provider';

describe('SshProvider allocation routing (ADR-060)', () => {
  it('overlays workspace usage while retaining physical target credentials', () => {
    const provider = new SshProvider();
    const effective = (
      provider as unknown as {
        eff: (input: unknown) => {
          remoteRoot: string;
          publicUrl: string;
          username: string;
          password: string;
        };
      }
    ).eff({
      connection: {
        host: 'vps.example.test',
        port: 22,
        username: 'deploy',
        password: 'test-only',
        remoteRoot: '/srv/apps',
        publicUrl: 'https://apps.example.test',
      },
      allocation: {
        rootPath: '/srv/apps/team-alpha',
        publicUrl: 'https://apps.example.test/team-alpha',
      },
    });

    expect(effective.remoteRoot).toBe('/srv/apps/team-alpha');
    expect(effective.publicUrl).toBe('https://apps.example.test/team-alpha');
    expect(effective.username).toBe('deploy');
    expect(effective.password).toBe('test-only');
  });
});
