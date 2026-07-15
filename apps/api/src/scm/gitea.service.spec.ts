jest.mock('../config', () => ({
  config: {
    gitea: {
      internalUrl: 'http://gitea:3000',
      adminToken: 'admin-token',
    },
  },
}));

import { GiteaService } from './gitea.service';

describe('GiteaService CI retry tags', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes stale retry tags and creates a new tag at the same commit', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'v1.0.0' }, { name: 'initpad-retry-old' }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const service = new GiteaService();
    const tag = await service.createRetryTag(
      'nette',
      '73dd7a50580d86c71bb380cf810b6e11cdf1f83a',
      { username: 'kudrla', token: 'owner-token' },
    );

    expect(tag).toMatch(/^initpad-retry-[a-z0-9-]+$/);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://gitea:3000/api/v1/repos/kudrla/nette/tags/initpad-retry-old',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://gitea:3000/api/v1/repos/kudrla/nette/tags',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('73dd7a50580d86c71bb380cf810b6e11cdf1f83a'),
      }),
    );
  });

  it('never deletes non-InitPad tags', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await new GiteaService().deleteTag('nette', 'v1.0.0', {
      username: 'kudrla',
      token: 'owner-token',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GiteaService repository detach', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes platform secrets and disables Actions while preserving the repository', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    for (let i = 0; i < 5; i++) fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await new GiteaService().detachRepo('nette', {
      username: 'kudrla',
      token: 'owner-token',
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gitea:3000/api/v1/repos/kudrla/nette/actions/secrets/INITPAD_REGISTRY_PASSWORD',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://gitea:3000/api/v1/repos/kudrla/nette',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ has_actions: false }),
      }),
    );
  });

  it('does not detach partially when Gitea refuses secret removal', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    await expect(
      new GiteaService().detachRepo('nette', { username: 'kudrla', token: 'owner-token' }),
    ).rejects.toThrow("Could not remove Actions secret 'INITPAD_DEPLOY_TOKEN'");
  });
});

describe('GiteaService import helpers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists the user repositories', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: 'api', full_name: 'kudrla/api', private: true, default_branch: 'main', updated_at: '2026-01-01T00:00:00Z', empty: false },
        ]),
        { status: 200 },
      ),
    );
    const repos = await new GiteaService().listRepositories({ username: 'kudrla', token: 't' });
    expect(repos).toEqual([
      { name: 'api', fullName: 'kudrla/api', private: true, defaultBranch: 'main', updatedAt: '2026-01-01T00:00:00Z', empty: false },
    ]);
  });

  it('reads and base64-decodes a file, and returns null when missing', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: Buffer.from('FROM node').toString('base64'), encoding: 'base64' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const service = new GiteaService();
    expect(await service.readFile('api', 'Dockerfile', 'main', { username: 'kudrla', token: 't' })).toBe('FROM node');
    expect(await service.readFile('api', 'missing', 'main', { username: 'kudrla', token: 't' })).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://gitea:3000/api/v1/repos/kudrla/api/contents/Dockerfile?ref=main',
      expect.anything(),
    );
  });
});
