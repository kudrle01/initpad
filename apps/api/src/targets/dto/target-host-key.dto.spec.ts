import { validate } from 'class-validator';
import { CreateTargetDto } from './create-target.dto';

function sftpDto(hostKeyFingerprint?: string): CreateTargetDto {
  return Object.assign(new CreateTargetDto(), {
    name: 'Shared host',
    kind: 'sftp',
    capabilities: ['static'],
    host: 'sftp.example.test',
    port: 22,
    username: 'deploy',
    auth: 'password',
    secret: 'test-only-password',
    hostKeyFingerprint,
    remotePath: '/www',
    publicUrl: 'https://apps.example.test',
  });
}

describe('CreateTargetDto host identity', () => {
  it('requires a SHA-256 host-key fingerprint for SFTP', async () => {
    const errors = await validate(sftpDto());
    expect(errors.some(({ property }) => property === 'hostKeyFingerprint')).toBe(true);
  });

  it('accepts an OpenSSH SHA-256 fingerprint', async () => {
    const errors = await validate(sftpDto('SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg'));
    expect(errors).toHaveLength(0);
  });
});
