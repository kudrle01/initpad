import { GitHubScmProvider } from './github-scm.provider';

const actor = { username: 'acme', token: 'ignored' };

function make(fetchImpl: jest.Mock) {
  const installations = { tokenForOwner: jest.fn(async () => ({ token: 'ghs_x', expiresAt: 'z' })) };
  global.fetch = fetchImpl as never;
  return { provider: new GitHubScmProvider(installations as never), installations };
}

const savedFetch = global.fetch;
afterEach(() => {
  global.fetch = savedFetch;
  jest.restoreAllMocks();
});

describe('GitHubScmProvider reads', () => {
  it('lists installation repositories with a scoped token', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        repositories: [
          { name: 'api', full_name: 'acme/api', private: true, default_branch: 'main', updated_at: 't', size: 42 },
          { name: 'fresh', full_name: 'acme/fresh', private: false, default_branch: 'main', updated_at: 't', size: 0 },
        ],
      }),
    }));
    const { provider, installations } = make(fetchMock);
    const repos = await provider.listRepositories(actor);
    expect(installations.tokenForOwner).toHaveBeenCalledWith('acme', {
      permissions: { metadata: 'read', contents: 'read' },
    });
    expect(repos[0]).toMatchObject({ name: 'api', fullName: 'acme/api', empty: false });
    expect(repos[1].empty).toBe(true); // size 0
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/installation/repositories');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghs_x');
  });

  it('reads and decodes a file, and returns null on 404', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: Buffer.from('FROM node').toString('base64'), encoding: 'base64' }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const { provider } = make(fetchMock);
    expect(await provider.readFile('api', 'Dockerfile', 'main', actor)).toBe('FROM node');
    expect(await provider.readFile('api', 'nope', 'main', actor)).toBeNull();
  });

  it('does not turn a permission failure into a missing file', async () => {
    const { provider } = make(jest.fn(async () => ({ ok: false, status: 403 })));
    await expect(provider.readFile('api', 'Dockerfile', 'main', actor)).rejects.toThrow('HTTP 403');
  });

  it('reports a missing repository only on 404, never on error', async () => {
    const { provider } = make(jest.fn(async () => ({ status: 404, ok: false })));
    expect(await provider.repoMissing('gone', actor)).toBe(true);
    const { provider: p2 } = make(jest.fn(async () => ({ status: 200, ok: true })));
    expect(await p2.repoMissing('there', actor)).toBe(false);
    const installations = { tokenForOwner: jest.fn(async () => { throw new Error('no installation'); }) };
    const p3 = new GitHubScmProvider(installations as never);
    expect(await p3.repoMissing('x', actor)).toBe(false);
  });

  it('maps commits and combined statuses', async () => {
    const commits = make(jest.fn(async () => ({ ok: true, json: async () => ([{ sha: 'abc', commit: { message: 'init', author: { name: 'Dev', date: 'd' } } }]) })));
    expect(await commits.provider.listCommits('api', actor)).toEqual([{ sha: 'abc', message: 'init', author: 'Dev', date: 'd' }]);

    const statuses = make(jest.fn(async () => ({ ok: true, json: async () => ({ statuses: [{ context: 'ci', state: 'success', target_url: 'https://x' }] }) })));
    expect(await statuses.provider.listCommitStatuses('api', 'abc', actor)).toEqual([{ context: 'ci', status: 'success', targetUrl: 'https://x' }]);
  });

  it('throws clearly for operations that are not wired yet', async () => {
    const { provider } = make(jest.fn());
    await expect(provider.provision()).rejects.toThrow('not implemented');
    await expect(provider.configureRepoSecrets()).rejects.toThrow('not implemented');
  });
});

describe('GitHubScmProvider writes', () => {
  it('deletes a repository and tolerates 404', async () => {
    const del = make(jest.fn(async () => ({ ok: true, status: 204 })));
    await expect(del.provider.deleteRepo('api', actor)).resolves.toBeUndefined();
    expect(del.installations.tokenForOwner).toHaveBeenCalledWith('acme', {
      permissions: { metadata: 'read', administration: 'write' },
    });
    const gone = make(jest.fn(async () => ({ ok: false, status: 404 })));
    await expect(gone.provider.deleteRepo('api', actor)).resolves.toBeUndefined();
    const err = make(jest.fn(async () => ({ ok: false, status: 500 })));
    await expect(err.provider.deleteRepo('api', actor)).rejects.toThrow('HTTP 500');
  });

  it('grants a collaborator the mapped permission and skips the owner', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 201 }));
    const { provider, installations } = make(fetchMock);
    await provider.setCollaborator('https://github.com/acme/api', 'dev', 'viewer');
    expect(installations.tokenForOwner).toHaveBeenCalledWith('acme', {
      permissions: { metadata: 'read', administration: 'write' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/acme/api/collaborators/dev');
    expect(JSON.parse(init.body as string)).toEqual({ permission: 'pull' });
    // Owner is never added as their own collaborator.
    fetchMock.mockClear();
    await provider.setCollaborator('https://github.com/acme/api', 'acme', 'admin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces stale retry tags and creates a new one at the sha', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ ref: 'refs/tags/initpad-retry-old' }]) }) // list
      .mockResolvedValueOnce({ ok: true, status: 204 }) // delete stale (deleteTag → new token + DELETE)
      .mockResolvedValueOnce({ ok: true, status: 201 }); // create
    const { provider } = make(fetchMock);
    const tag = await provider.createRetryTag('api', 'deadbeef', actor);
    expect(tag).toMatch(/^initpad-retry-/);
    const createCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [string, RequestInit];
    expect(createCall[0]).toContain('/repos/acme/api/git/refs');
    expect(JSON.parse(createCall[1].body as string).sha).toBe('deadbeef');
  });

  it('detaches by removing platform secrets and disabling Actions', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 }));
    const { provider } = make(fetchMock);
    await provider.detachRepo('api', actor);
    // 5 secret deletions + 1 permissions PUT.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const last = fetchMock.mock.calls[5] as unknown as [string, RequestInit];
    expect(last[0]).toContain('/actions/permissions');
    expect(JSON.parse(last[1].body as string)).toEqual({ enabled: false });
  });

  it('issues an installation token as the clone credential', async () => {
    const { provider, installations } = make(jest.fn());
    expect(await provider.issueCloneToken('acme')).toBe('ghs_x');
    expect(installations.tokenForOwner).toHaveBeenCalledWith('acme', {
      permissions: { metadata: 'read', contents: 'read' },
    });
  });
});
