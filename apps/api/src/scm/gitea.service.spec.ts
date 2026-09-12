jest.mock('../config', () => ({
  config: {
    gitea: {
      internalUrl: 'http://gitea:3000',
      url: 'http://localhost:3000',
      adminToken: 'admin-token',
    },
  },
}));

import { GiteaService } from './gitea.service';
import { ScmHttpStatusError } from './scm-http';

const repository = (name = 'nette') => ({
  provider: 'gitea' as const,
  repositoryId: '101',
  owner: 'kudrla',
  name,
  fullName: `kudrla/${name}`,
  defaultBranch: 'main',
  repoUrl: `http://localhost:3000/kudrla/${name}`,
  installationId: null,
});

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
      repository(),
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
    await new GiteaService().deleteTag(repository(), 'v1.0.0', {
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
    for (let i = 0; i < 5; i++)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await new GiteaService().detachRepo(repository(), {
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
      new GiteaService().detachRepo(repository(), { username: 'kudrla', token: 'owner-token' }),
    ).rejects.toThrow("Could not remove Actions secret 'INITPAD_DEPLOY_TOKEN'");
  });

  it('refuses a locator owned by another provider before making a request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      new GiteaService().deleteRepo(
        { ...repository(), provider: 'github' },
        { username: 'kudrla', token: 'owner-token' },
      ),
    ).rejects.toThrow('Gitea adapter cannot operate on github');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GiteaService import helpers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists the user repositories', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 101,
            name: 'api',
            full_name: 'kudrla/api',
            private: true,
            default_branch: 'main',
            updated_at: '2026-01-01T00:00:00Z',
            empty: false,
          },
        ]),
        { status: 200 },
      ),
    );
    const repos = await new GiteaService().listRepositories({ username: 'kudrla', token: 't' });
    expect(repos).toEqual([
      {
        provider: 'gitea',
        repositoryId: '101',
        owner: 'kudrla',
        name: 'api',
        fullName: 'kudrla/api',
        repoUrl: 'http://localhost:3000/kudrla/api',
        installationId: null,
        private: true,
        defaultBranch: 'main',
        updatedAt: '2026-01-01T00:00:00Z',
        empty: false,
      },
    ]);
  });

  it('reads and base64-decodes a file, and returns null when missing', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: Buffer.from('FROM node').toString('base64'),
            encoding: 'base64',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const service = new GiteaService();
    expect(
      await service.readFile(repository('api'), 'Dockerfile', 'main', {
        username: 'kudrla',
        token: 't',
      }),
    ).toBe('FROM node');
    expect(
      await service.readFile(repository('api'), 'missing', 'main', {
        username: 'kudrla',
        token: 't',
      }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://gitea:3000/api/v1/repos/kudrla/api/contents/Dockerfile?ref=main',
      expect.anything(),
    );
  });

  it('does not misreport an authorization or server failure as a missing file', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    await expect(
      new GiteaService().readFile(repository('api'), 'Dockerfile', 'main', {
        username: 'kudrla',
        token: 't',
      }),
    ).rejects.toThrow('HTTP 403');
  });

  it('captures and restores a direct collaborator permission', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ login: 'alice' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ permission: 'read' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const service = new GiteaService();
    const access = await service.getCollaboratorAccess(repository('api'), 'alice');
    expect(access).toBe('read');
    await service.restoreCollaboratorAccess(repository('api'), 'alice', access);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://gitea:3000/api/v1/repos/kudrla/api/collaborators/alice',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ permission: 'read' }) }),
    );
  });

  it('returns null for inherited or absent access instead of inventing a direct grant', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ login: 'someone-else' }]), { status: 200 }),
      );
    await expect(
      new GiteaService().getCollaboratorAccess(repository('api'), 'alice'),
    ).resolves.toBeNull();
  });
});

describe('GiteaService managed account hardening', () => {
  afterEach(() => jest.restoreAllMocks());

  it('replaces a managed local password with a random unknown value', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await new GiteaService().randomizeUserPassword('alice');
    const [, init] = fetchMock.mock.calls[0] as [string | URL | Request, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ login_name: 'alice', source_id: 0, must_change_password: false });
    expect(body.password).toHaveLength(47);
  });

  it('does not copy an upstream response body into clone-token errors', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('internal details with upstream-secret', { status: 403 }),
      );

    const error = await new GiteaService()
      .issueCloneToken('alice')
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ScmHttpStatusError);
    expect((error as Error).message).toContain('HTTP 403');
    expect((error as Error).message).not.toContain('upstream-secret');
  });
});
