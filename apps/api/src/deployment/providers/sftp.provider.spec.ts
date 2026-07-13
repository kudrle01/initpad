import { SftpProvider } from './sftp.provider';
import { getSftp, sshConnect, sshEnd, sshExec } from './ssh-utils';

jest.mock('./ssh-utils', () => ({
  getSftp: jest.fn(),
  shellQuote: jest.fn((value: string) => `'${value}'`),
  sshConnect: jest.fn(),
  sshEnd: jest.fn(),
  sshExec: jest.fn(),
  sftpRmrf: jest.fn(),
  sftpUnlink: jest.fn(),
}));

describe('SftpProvider teardown', () => {
  const connection = {
    host: 'sftp.example.test',
    port: 22,
    username: 'student',
    password: 'test-only',
    remoteRoot: '/srv/student',
    publicUrl: 'https://example.test/~student',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(sshConnect).mockResolvedValue({} as never);
    jest.mocked(getSftp).mockResolvedValue({} as never);
  });

  it('reports public removal separately when runtime-owned data is quarantined', async () => {
    jest
      .mocked(sshExec)
      .mockResolvedValueOnce({ code: 0, stdout: 'ok\n', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'Permission denied' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({
        code: 0,
        stdout:
          '/srv/student/.initpad-quarantine/team-app-prod-runtime-one\n' +
          '/srv/student/.initpad-quarantine/team-app-prod-legacy\n',
        stderr: '',
      });

    const result = await new SftpProvider().teardown({
      projectName: 'team-app',
      env: 'prod',
      connection,
    });

    expect(result?.warning).toContain('Public deployment removed');
    expect(result?.warning).toContain('team-app-prod-runtime-one');
    expect(sshEnd).toHaveBeenCalled();
    expect(jest.mocked(sshExec).mock.calls[1][1]).toContain("'/srv/student/team-app-prod'");
  });

  it('fails closed when the protected quarantine cannot be inspected', async () => {
    jest
      .mocked(sshExec)
      .mockResolvedValueOnce({ code: 0, stdout: 'ok\n', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'find failed' });

    const result = await new SftpProvider().teardown({
      projectName: 'team-app',
      env: 'prod',
      connection,
    });

    expect(result?.warning).toContain('could not be verified');
  });
});
