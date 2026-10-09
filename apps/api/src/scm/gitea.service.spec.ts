jest.mock('../config', () => ({
  config: {
    gitea: {
      internalUrl: 'http://gitea:3000',
      url: 'http://localhost:3000',
      adminToken: 'admin-token',
    },
    registry: { ciHost: 'host.docker.internal:3001' },
    ci: { platformUrl: 'http://platform.internal' },
  },
}));

import { GiteaService } from './gitea.service';
import { ScmHttpStatusError } from './scm-http';

// Minimal stateful stand-in for the Gitea endpoints behind token management
// and repository secrets. Behaviour mirrors Gitea 1.22: token names are unique
// per account and token endpoints accept only Basic authentication.
function fakeGitea(options: { missingUsers?: string[]; failTokenCreate?: boolean } = {}) {
  const calls: string[] = [];
  const bodies = new Map<string, unknown>();
  const authorizations = new Map<string, string>();
  const passwords = new Map<string, string>();
  const tokens = new Map<string, Array<{ id: number; name: string; scopes: string[] }>>();
  const secrets = new Map<string, string>();
  let nextId = 1;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    calls.push(key);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body !== undefined) bodies.set(key, body);
    const authorization = new Headers(init?.headers).get('Authorization') ?? '';
    authorizations.set(key, authorization);

    let match = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (match && method === 'PATCH') {
      if (options.missingUsers?.includes(match[1])) return json({ message: 'missing' }, 404);
      passwords.set(match[1], (body as { password: string }).password);
      return json({});
    }
    match = url.pathname.match(/^\/api\/v1\/users\/([^/]+)\/tokens(?:\/([^/]+))?$/);
    if (match) {
      const [, user, tokenKey] = match;
      const expected = `Basic ${Buffer.from(`${user}:${passwords.get(user)}`).toString('base64')}`;
      if (authorization !== expected) return json({ message: 'unauthorized' }, 401);
      const owned = tokens.get(user) ?? [];
      tokens.set(user, owned);
      if (method === 'GET') return json(owned);
      if (method === 'DELETE') {
        const index = owned.findIndex(
          (token) => token.name === decodeURIComponent(tokenKey) || String(token.id) === tokenKey,
        );
        if (index < 0) return json({ message: 'not found' }, 404);
        owned.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      const { name, scopes } = body as { name: string; scopes: string[] };
      if (options.failTokenCreate) return json({ message: 'boom' }, 500);
      if (owned.some((token) => token.name === name)) return json({ message: 'exists' }, 400);
      const id = nextId++;
      owned.push({ id, name, scopes });
      return json({ id, name, sha1: `token-${id}`, scopes }, 201);
    }
    match = url.pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/secrets\/([^/]+)$/);
    if (match) {
      const secret = `${match[1]}/${match[2]}:${match[3]}`;
      if (method === 'PUT') {
        secrets.set(secret, (body as { data: string }).data);
        return new Response(null, { status: 201 });
      }
      secrets.delete(secret);
      return new Response(null, { status: 204 });
    }
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      return method === 'DELETE' ? new Response(null, { status: 204 }) : json({});
    }
    return json({ message: `unexpected ${key}` }, 500);
  });
  return {
    calls,
    fetchMock,
    tokens,
    secrets,
    seedToken(user: string, name: string, scopes: string[]) {
      const owned = tokens.get(user) ?? [];
      owned.push({ id: nextId++, name, scopes });
      tokens.set(user, owned);
    },
    lastBody: (key: string) => bodies.get(key),
    authorization: (key: string) => authorizations.get(key),
  };
}

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

  it('removes platform secrets, revokes the registry token and disables Actions', async () => {
    const gitea = fakeGitea();
    await new GiteaService().detachRepo(repository(), {
      username: 'kudrla',
      token: 'owner-token',
    });

    expect(gitea.calls).toContainEqual(
      'DELETE /api/v1/repos/kudrla/nette/actions/secrets/INITPAD_REGISTRY_PASSWORD',
    );
    expect(gitea.calls).toContainEqual('DELETE /api/v1/users/kudrla/tokens/initpad-registry-101');
    expect(gitea.calls.at(-1)).toBe('PATCH /api/v1/repos/kudrla/nette');
    expect(gitea.lastBody('PATCH /api/v1/repos/kudrla/nette')).toEqual({ has_actions: false });
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

describe('GiteaService scoped credentials (ADR-134)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gives CI a package-only registry token instead of a user credential', async () => {
    const gitea = fakeGitea();
    await new GiteaService().configureRepoSecrets(repository(), 'deploy-secret');

    expect(gitea.tokens.get('kudrla')).toEqual([
      { id: 1, name: 'initpad-registry-101', scopes: ['write:package'] },
    ]);
    expect(gitea.secrets.get('kudrla/nette:INITPAD_DEPLOY_TOKEN')).toBe('deploy-secret');
    expect(gitea.secrets.get('kudrla/nette:INITPAD_REGISTRY_USER')).toBe('kudrla');
    expect(gitea.secrets.get('kudrla/nette:INITPAD_REGISTRY_PASSWORD')).toBe('token-1');
    // The temporary password used for token management is replaced afterwards.
    expect(gitea.calls.filter((call) => call === 'PATCH /api/v1/admin/users/kudrla')).toHaveLength(
      2,
    );
  });

  it('replaces the registry token on rotation so an earlier copy stops working', async () => {
    const gitea = fakeGitea();
    const service = new GiteaService();
    await service.configureRepoSecrets(repository(), 'deploy-secret');
    await service.rotateRegistryCredential(repository());

    expect(gitea.tokens.get('kudrla')).toEqual([
      { id: 2, name: 'initpad-registry-101', scopes: ['write:package'] },
    ]);
    expect(gitea.secrets.get('kudrla/nette:INITPAD_REGISTRY_PASSWORD')).toBe('token-2');
  });

  it('issues a clone token that can only clone and push code', async () => {
    const gitea = fakeGitea();
    gitea.seedToken('alice', 'initpad-git', ['write:repository']);
    const token = await new GiteaService().issueCloneToken('alice');

    expect(token).toBe('token-2');
    expect(gitea.tokens.get('alice')).toEqual([
      { id: 2, name: 'initpad-git', scopes: ['write:repository'] },
    ]);
  });

  it('serializes token operations of one account', async () => {
    const gitea = fakeGitea();
    const service = new GiteaService();
    await Promise.all([service.issueCloneToken('alice'), service.issueCloneToken('alice')]);

    // A second temporary password must not overwrite the first mid-operation.
    expect(gitea.calls).toEqual([
      'PATCH /api/v1/admin/users/alice',
      'DELETE /api/v1/users/alice/tokens/initpad-git',
      'POST /api/v1/users/alice/tokens',
      'PATCH /api/v1/admin/users/alice',
      'PATCH /api/v1/admin/users/alice',
      'DELETE /api/v1/users/alice/tokens/initpad-git',
      'POST /api/v1/users/alice/tokens',
      'PATCH /api/v1/admin/users/alice',
    ]);
    expect(gitea.tokens.get('alice')).toHaveLength(1);
  });

  it('randomizes the temporary password even when token creation fails', async () => {
    const gitea = fakeGitea({ failTokenCreate: true });
    await expect(new GiteaService().issueCloneToken('alice')).rejects.toThrow('HTTP 500');
    expect(gitea.calls.at(-1)).toBe('PATCH /api/v1/admin/users/alice');
  });

  it('revokes only the legacy full-scope tokens', async () => {
    const gitea = fakeGitea();
    gitea.seedToken('alice', 'initpad-platform-1700000000000', ['write:user']);
    gitea.seedToken('alice', 'initpad-platform-1700000000001', ['write:user']);
    gitea.seedToken('alice', 'initpad-git', ['write:repository']);
    gitea.seedToken('alice', 'personal laptop', ['read:repository']);

    await new GiteaService().revokeLegacyCredentials('alice');

    expect(gitea.tokens.get('alice')?.map((token) => token.name)).toEqual([
      'initpad-git',
      'personal laptop',
    ]);
  });

  it('treats an account unknown to Gitea as having no clone token', async () => {
    fakeGitea({ missingUsers: ['ghost'] });
    await expect(new GiteaService().revokeCloneToken('ghost')).resolves.toBeUndefined();
  });

  it('revokes the registry token together with the repository', async () => {
    const gitea = fakeGitea();
    gitea.seedToken('kudrla', 'initpad-registry-101', ['write:package']);
    await new GiteaService().deleteRepo(repository(), { username: 'kudrla', token: '' });

    expect(gitea.calls[0]).toBe('DELETE /api/v1/repos/kudrla/nette');
    expect(gitea.tokens.get('kudrla')).toEqual([]);
  });
});
