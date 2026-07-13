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
