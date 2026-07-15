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
    expect(installations.tokenForOwner).toHaveBeenCalledWith('acme');
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
