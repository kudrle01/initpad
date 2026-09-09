import {
  collectScmPages,
  findInScmPages,
  ScmHttpStatusError,
  ScmHttpTransportError,
  scmFetch,
  scmStatusError,
} from './scm-http';

describe('SCM HTTP boundary', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('adds a deadline while preserving request details', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchMock as never;

    await scmFetch('GitHub', 'read repository', 'https://api.example/repos/one', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: '{}',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/repos/one',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('does not expose URL or credentials in a transport failure', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('request to https://token@example.test failed');
    }) as never;

    const error = await scmFetch(
      'Gitea',
      'list repositories',
      'https://admin:secret@example.test/api',
      { headers: { Authorization: 'token secret' } },
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ScmHttpTransportError);
    expect((error as Error).message).toBe('Gitea list repositories request failed');
    expect((error as Error).message).not.toMatch(/admin|secret|example\.test/);
  });

  it('reports an expired request deadline as a timeout', async () => {
    global.fetch = jest.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as never;

    await expect(
      scmFetch('GitHub', 'read repository', 'https://api.example/repos/one', {}, 1),
    ).rejects.toMatchObject({ timedOut: true });
  });

  it.each([
    [401, 'authentication', false],
    [403, 'permission', false],
    [404, 'not-found', false],
    [422, 'conflict', false],
    [429, 'rate-limit', true],
    [503, 'unavailable', true],
  ] as const)('maps HTTP %s to %s', (status, kind, retryable) => {
    const error = scmStatusError(
      'GitHub',
      'create repository',
      { status },
      'Repository creation failed',
    );
    expect(error).toBeInstanceOf(ScmHttpStatusError);
    expect(error).toMatchObject({ status, kind, retryable });
    expect(error.message).toBe(`Repository creation failed (HTTP ${status})`);
  });
});

describe('bounded SCM pagination', () => {
  it('collects complete pages and includes the final partial page', async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce([3]);
    await expect(collectScmPages({
      provider: 'GitHub',
      operation: 'list repositories',
      pageSize: 2,
      load,
    })).resolves.toEqual([1, 2, 3]);
    expect(load).toHaveBeenNthCalledWith(2, 2);
  });

  it('stops scanning after a match without loading another page', async () => {
    const load = jest.fn().mockResolvedValueOnce(['alice', 'bob']);
    await expect(findInScmPages({
      provider: 'Gitea',
      operation: 'find collaborator',
      pageSize: 2,
      load,
      find: (items) => items.find((item) => item === 'bob'),
    })).resolves.toBe('bob');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('fails at the configured boundary instead of silently truncating', async () => {
    await expect(collectScmPages({
      provider: 'GitHub',
      operation: 'list repositories',
      pageSize: 1,
      maxPages: 2,
      load: async (page) => [page],
    })).rejects.toThrow('exceeded the pagination limit');
  });
});
