import { UnauthorizedException } from '@nestjs/common';
import { CiController } from './ci.controller';

describe('CiController callbacks', () => {
  it('records the moment a runner actually starts the first job', async () => {
    const projects = { ciStarted: jest.fn(async () => undefined) };
    const controller = new CiController(projects as never);

    await expect(controller.start('Bearer repo-secret', {
      repo: 'acme/api',
      sha: 'a'.repeat(40),
      ref: 'main',
    })).resolves.toEqual({ accepted: true });
    expect(projects.ciStarted).toHaveBeenCalledWith(
      'acme/api', 'a'.repeat(40), 'main', 'repo-secret',
    );
  });

  it('passes the immutable artifact locator only after bearer authentication', async () => {
    const projects = { deployFromCi: jest.fn(async () => undefined) };
    const controller = new CiController(projects as never);
    await expect(controller.deploy('Bearer repo-secret', {
      repo: 'acme/api',
      sha: 'a'.repeat(40),
      ref: 'main',
      ciStatus: 'success',
      artifactId: '987',
      artifactDigest: 'b'.repeat(64),
    })).resolves.toEqual({ accepted: true });
    expect(projects.deployFromCi).toHaveBeenCalledWith(
      'acme/api',
      'a'.repeat(40),
      'main',
      'repo-secret',
      { ciStatus: 'success', artifactId: '987', artifactDigest: 'b'.repeat(64) },
    );
  });

  it('rejects a callback without its repository bearer token', async () => {
    const controller = new CiController({ deployFromCi: jest.fn() } as never);
    await expect(controller.deploy('', { repo: 'acme/api' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.start('', { repo: 'acme/api' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
