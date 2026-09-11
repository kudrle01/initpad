import type { SFTPWrapper } from 'ssh2';
import {
  assertSftpWritable,
  normalizeHostKeyFingerprint,
  portSlot,
  sftpRmrf,
  shellQuote,
  sshHostKeyFingerprint,
} from './ssh-utils';

describe('SSH host identity', () => {
  it('uses the OpenSSH SHA256 fingerprint representation', () => {
    expect(sshHostKeyFingerprint(Buffer.from('initpad-host-key'))).toBe(
      'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
    );
  });

  it('normalizes optional base64 padding from administrator input', () => {
    expect(normalizeHostKeyFingerprint(' SHA256:abc= ')).toBe('SHA256:abc');
  });
});

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

describe('assertSftpWritable', () => {
  it('creates and removes a child probe below an existing webroot', async () => {
    const mkdir = jest.fn((_path: string, cb: (err?: Error) => void) => cb());
    const rmdir = jest.fn((_path: string, cb: (err?: Error) => void) => cb());
    const sftp = { mkdir, rmdir } as unknown as SFTPWrapper;

    await expect(assertSftpWritable(sftp, '/www/')).resolves.toBeUndefined();
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(mkdir.mock.calls[0][0]).toBe('/www');
    expect(mkdir.mock.calls[1][0]).toMatch(/^\/www\/\.initpad-write-/);
    expect(rmdir.mock.calls[0][0]).toMatch(/^\/www\/\.initpad-write-/);
  });

  it('rejects a webroot that exists but does not allow child creation', async () => {
    const sftp = {
      mkdir: (path: string, cb: (err?: Error) => void) =>
        cb(path === '/www' ? Object.assign(new Error('exists'), { code: 4 }) : new Error('Permission denied')),
      stat: (path: string, cb: (err?: Error) => void) =>
        cb(path === '/www' ? undefined : new Error('No such file')),
      rmdir: jest.fn(),
    } as unknown as SFTPWrapper;

    await expect(assertSftpWritable(sftp, '/www')).rejects.toThrow(
      'mkdir /www/.initpad-write-',
    );
  });
});
