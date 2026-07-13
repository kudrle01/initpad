import type { SFTPWrapper } from 'ssh2';
import { portSlot, sftpRmrf, shellQuote } from './ssh-utils';

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

describe('shellQuote', () => {
  it('quotes paths and embedded single quotes for a POSIX shell', () => {
    expect(shellQuote('/srv/project prod')).toBe("'/srv/project prod'");
    expect(shellQuote("/srv/user's-app")).toBe("'/srv/user'\"'\"'s-app'");
  });
});

describe('sftpRmrf', () => {
  it('treats a missing root as already removed', async () => {
    const sftp = {
      readdir: (_path: string, cb: (err: Error & { code?: number }) => void) =>
        cb(Object.assign(new Error('No such file'), { code: 2 })),
    } as unknown as SFTPWrapper;

    await expect(sftpRmrf(sftp, '/missing')).resolves.toBeUndefined();
  });

  it('propagates permission failures instead of reporting false success', async () => {
    const sftp = {
      readdir: (_path: string, cb: (err: Error) => void) =>
        cb(Object.assign(new Error('Permission denied'), { code: 3 })),
    } as unknown as SFTPWrapper;

    await expect(sftpRmrf(sftp, '/owned-by-runtime')).rejects.toThrow('Permission denied');
  });
});
