import { DeploymentService } from './deployment.service';

describe('DeploymentService image lifecycle', () => {
  function serviceWithProviders() {
    const docker = {
      kind: 'docker',
      cleanupImage: jest.fn(async () => undefined),
    };
    const sftp = {
      kind: 'sftp',
      teardown: jest.fn(async () => ({ warning: 'remote cleanup pending' })),
    };
    const ssh = { kind: 'ssh' };
    const service = new DeploymentService(docker as never, sftp as never, ssh as never);
    return { service, docker, sftp };
  }

  it('releases an extracted local image after an SFTP teardown', async () => {
    const { service, docker, sftp } = serviceWithProviders();
    const input = {
      projectName: 'acme-site',
      env: 'prod',
      imageRef: '127.0.0.1:3001/acme/site:commit',
    };

    await expect(service.teardown('sftp', input)).resolves.toEqual({
      warning: 'remote cleanup pending',
    });
    expect(sftp.teardown).toHaveBeenCalledWith(input);
    expect(docker.cleanupImage).toHaveBeenCalledWith(input.imageRef);
  });

  it('still releases the local image when remote teardown fails', async () => {
    const { service, docker, sftp } = serviceWithProviders();
    sftp.teardown.mockRejectedValueOnce(new Error('remote unavailable'));

    await expect(
      service.teardown('sftp', {
        projectName: 'acme-site',
        env: 'prod',
        imageRef: '127.0.0.1:3001/acme/site:commit',
      }),
    ).rejects.toThrow('remote unavailable');
    expect(docker.cleanupImage).toHaveBeenCalledTimes(1);
  });

  it('does not perform image cleanup when the environment has no bound artifact', async () => {
    const { service, docker } = serviceWithProviders();

    await service.teardown('sftp', { projectName: 'bootstrap', env: 'dev' });
    expect(docker.cleanupImage).not.toHaveBeenCalled();
  });
});
