import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createGzip } from 'zlib';
import sodium from 'libsodium-wrappers';
import * as tar from 'tar-fs';
import { config } from '../../config';
import { GitHubScmProvider } from './github-scm.provider';

const actor = { username: 'acme', token: 'ignored' };
const repository = (name = 'api') => ({
  provider: 'github' as const,
  repositoryId: '101',
  owner: 'acme',
  name,
  fullName: `acme/${name}`,
  defaultBranch: 'main',
  repoUrl: `https://github.com/acme/${name}`,
  installationId: 'installation-row-1',
});

function make(fetchImpl: jest.Mock) {
  const installations = {
    findByOwner: jest.fn(async () => ({ id: 'installation-row-1', installationId: '42' })),
    findById: jest.fn(async () => ({
      id: 'installation-row-1', installationId: '42', accountId: '987654',
      accountLogin: 'acme', accountType: 'Organization', repositorySelection: 'selected',
      suspendedAt: null, deletedAt: null,
    })),
    tokenForOwner: jest.fn(async () => ({ token: 'ghs_x', expiresAt: 'z' })),
    tokenForBinding: jest.fn(async () => ({ token: 'ghs_x', expiresAt: 'z' })),
  };
  const userCredentials = {
    accessTokenForUser: jest.fn(async () => 'ghu_user'),
  };
  global.fetch = fetchImpl as never;
  return {
    provider: new GitHubScmProvider(installations as never, userCredentials as never),
    installations,
    userCredentials,
  };
}

const savedFetch = global.fetch;
const savedFrontendUrl = config.auth.frontendUrl;
afterEach(() => {
  global.fetch = savedFetch;
  config.auth.frontendUrl = savedFrontendUrl;
  jest.restoreAllMocks();
});

describe('GitHubScmProvider reads', () => {
  it('lists installation repositories with a scoped token', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        repositories: [
          { id: 101, name: 'api', full_name: 'acme/api', private: true, default_branch: 'main', updated_at: 't', size: 42 },
          { id: 102, name: 'fresh', full_name: 'acme/fresh', private: false, default_branch: 'main', updated_at: 't', size: 0 },
        ],
      }),
    }));
    const { provider, installations } = make(fetchMock);
    const repos = await provider.listRepositories(actor);
    expect(installations.tokenForOwner).toHaveBeenCalledWith('acme', {
      permissions: { metadata: 'read', contents: 'read' },
    });
    expect(repos[0]).toMatchObject({
      repositoryId: '101', name: 'api', fullName: 'acme/api',
      installationId: 'installation-row-1', empty: false,
    });
    expect(repos[1].empty).toBe(true); // size 0
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/installation/repositories');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghs_x');
  });

  it('paginates all installation repositories', async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => ({
      id, name: `repo-${id}`, full_name: `acme/repo-${id}`, private: true,
    }));
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ repositories: firstPage }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repositories: [{ id: 100, name: 'last', full_name: 'acme/last', private: true }],
        }),
      });
    const { provider } = make(fetchMock);
    await expect(provider.listRepositories(actor)).resolves.toHaveLength(101);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toContain('page=2');
  });

  it('reads and decodes a file, and returns null on 404', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: Buffer.from('FROM node').toString('base64'), encoding: 'base64' }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const { provider } = make(fetchMock);
    expect(await provider.readFile(repository(), 'Dockerfile', 'main', actor)).toBe('FROM node');
    expect(await provider.readFile(repository(), 'nope', 'main', actor)).toBeNull();
  });

  it('does not turn a permission failure into a missing file', async () => {
    const { provider } = make(jest.fn(async () => ({ ok: false, status: 403 })));
    await expect(provider.readFile(repository(), 'Dockerfile', 'main', actor)).rejects.toThrow('HTTP 403');
  });

  it('reports a missing repository only on 404, never on error', async () => {
    const { provider } = make(jest.fn(async () => ({ status: 404, ok: false })));
    expect(await provider.repoMissing(repository('gone'), actor)).toBe(true);
    const { provider: p2 } = make(jest.fn(async () => ({ status: 200, ok: true })));
    expect(await p2.repoMissing(repository('there'), actor)).toBe(false);
    const installations = { tokenForBinding: jest.fn(async () => { throw new Error('no installation'); }) };
    const p3 = new GitHubScmProvider(installations as never, {} as never);
    expect(await p3.repoMissing(repository('x'), actor)).toBe(false);
  });

  it('maps commits and combined statuses', async () => {
    const commits = make(jest.fn(async () => ({ ok: true, json: async () => ([{ sha: 'abc', commit: { message: 'init', author: { name: 'Dev', date: 'd' } } }]) })));
    expect(await commits.provider.listCommits(repository(), actor)).toEqual([{ sha: 'abc', message: 'init', author: 'Dev', date: 'd' }]);

    const statuses = make(jest.fn(async () => ({ ok: true, json: async () => ({ statuses: [{ context: 'ci', state: 'success', target_url: 'https://x' }] }) })));
    expect(await statuses.provider.listCommitStatuses(repository(), 'abc', actor)).toEqual([{ context: 'ci', status: 'success', targetUrl: 'https://x' }]);
  });

  it('requires an explicit workspace-authorized installation for provisioning', async () => {
    const { provider } = make(jest.fn());
    await expect(provider.provision('api', '/tmp', actor, 'deploy-secret'))
      .rejects.toThrow('workspace-authorized');
  });

  it('downloads and unwraps an exact GitHub tarball', async () => {
    const source = mkdtempSync(join(tmpdir(), 'initpad-github-source-'));
    writeFileSync(join(source, 'README.md'), 'hello archive');
    const compressed: Buffer[] = [];
    const stream = tar.pack(source).pipe(createGzip());
    for await (const chunk of stream) compressed.push(Buffer.from(chunk));
    const { provider, installations } = make(
      jest.fn(async () => new Response(Buffer.concat(compressed), { status: 200 })),
    );
    try {
      const archive = await provider.downloadArchive(repository(), 'deadbeef', actor);
      expect(archive).not.toBeNull();
      expect(readFileSync(join(archive!.dir, 'README.md'), 'utf8')).toBe('hello archive');
      archive!.cleanup();
      expect(installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
        permissions: { metadata: 'read', contents: 'read' },
      });
    } finally {
      rmSync(source, { recursive: true, force: true });
    }
  });

  it('initializes the generated scaffold as a main-branch git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'initpad-github-git-'));
    writeFileSync(join(dir, 'README.md'), 'hello');
    const { provider } = make(jest.fn());
    try {
      await provider.initLocal(dir, { name: 'InitPad Test', email: 'test@initpad.local' });
      expect(execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('main');
      expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, encoding: 'utf8' }).trim()).toBe(
        'init: scaffold from template',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adapts shared Gitea workflow scaffolds for GitHub Actions and ephemeral GHCR auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'initpad-github-workflow-'));
    const workflowDir = join(dir, '.gitea', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, 'ci.yml'),
      [
        'name: ci',
        'on: [push]',
        'jobs:',
        '  docker:',
        '    steps:',
        '      - run: |',
        '          echo "${{ secrets.INITPAD_REGISTRY_PASSWORD }}" | \\',
        '            docker login "${{ secrets.INITPAD_REGISTRY }}" -u "${{ secrets.INITPAD_REGISTRY_USER }}" --password-stdin',
        '',
      ].join('\n'),
    );
    const { provider } = make(jest.fn());
    try {
      await provider.initLocal(dir, { name: 'InitPad Test', email: 'test@initpad.local' });
      const githubWorkflow = join(dir, '.github', 'workflows', 'ci.yml');
      expect(existsSync(githubWorkflow)).toBe(true);
      expect(existsSync(join(dir, '.gitea'))).toBe(false);
      const workflow = readFileSync(githubWorkflow, 'utf8');
      expect(workflow).toContain('permissions:\n  contents: read\n  packages: write');
      expect(workflow).toContain('${{ secrets.GITHUB_TOKEN }}');
      expect(workflow).toContain('${{ github.actor }}');
      expect(workflow).not.toContain('INITPAD_REGISTRY_PASSWORD');
      expect(workflow).not.toContain('INITPAD_REGISTRY_USER');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GitHubScmProvider writes', () => {
  const target = { userId: 'user-1', installationId: 'installation-row-1' };

  function createdRepository() {
    return {
      id: 101,
      name: 'api',
      full_name: 'acme/api',
      html_url: 'https://github.com/acme/api',
      owner: { id: 987654, login: 'acme' },
    };
  }

  it('creates an organization repository, configures secrets, then pushes with an installation token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => createdRepository() })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: 'key-1', key: 'ignored-by-spy' }),
      })
      .mockResolvedValue({ ok: true, status: 201 });
    const { provider, installations, userCredentials } = make(fetchMock);
    jest.spyOn(provider as any, 'setRepoSecrets').mockResolvedValue(undefined);
    const push = jest.spyOn(provider as any, 'pushScaffold').mockResolvedValue(undefined);

    await expect(
      provider.provision('api', '/generated', actor, 'deploy-secret', target),
    ).resolves.toMatchObject({
      provider: 'github', repositoryId: '101', fullName: 'acme/api',
      installationId: 'installation-row-1', defaultBranch: 'main',
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/orgs/acme/repos');
    expect(installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
      permissions: { metadata: 'read', administration: 'write' },
    });
    expect(installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
      permissions: {
        metadata: 'read', contents: 'write', workflows: 'write',
      },
    });
    expect(userCredentials.accessTokenForUser).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'acme/api' }), '/generated', 'ghs_x');
  });

  it('creates a personal repository with the initiating user credential', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true, status: 201, json: async () => createdRepository(),
    }));
    const { provider, installations, userCredentials } = make(fetchMock);
    installations.findById.mockResolvedValueOnce({
      id: 'installation-row-1', installationId: '42', accountId: '987654',
      accountLogin: 'acme', accountType: 'User', repositorySelection: 'selected',
      suspendedAt: null, deletedAt: null,
    });
    jest.spyOn(provider as any, 'setRepoSecrets').mockResolvedValue(undefined);
    jest.spyOn(provider as any, 'pushScaffold').mockResolvedValue(undefined);

    await provider.provision('api', '/generated', actor, 'deploy-secret', target);

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/user/repos');
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
      .toMatchObject({ Authorization: 'Bearer ghu_user' });
    expect(userCredentials.accessTokenForUser).toHaveBeenCalledWith('user-1');
    expect(installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
      permissions: {
        metadata: 'read', contents: 'write', workflows: 'write',
      },
    });
  });

  it('deletes the newly created repository when secret configuration fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => createdRepository() })
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const { provider } = make(fetchMock);

    await expect(
      provider.provision('api', '/generated', actor, 'deploy-secret', target),
    ).rejects.toThrow('public key');
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE') as
      | [string, RequestInit]
      | undefined;
    expect(deleteCall?.[0]).toContain('/repos/acme/api');
  });

  it('cleans up the deterministic destination when GitHub returns an invalid 201 body', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 101 }) })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const { provider } = make(fetchMock);

    await expect(
      provider.provision('api', '/generated', actor, 'deploy-secret', target),
    ).rejects.toThrow('invalid repository identity');
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE') as
      | [string, RequestInit]
      | undefined;
    expect(deleteCall?.[0]).toContain('/repos/acme/api');
  });

  it('refuses a locator owned by another provider before minting a token', async () => {
    const { provider, installations } = make(jest.fn());
    await expect(
      provider.deleteRepo({ ...repository(), provider: 'gitea' }, actor),
    ).rejects.toThrow('GitHub adapter cannot operate on gitea');
    expect(installations.tokenForBinding).not.toHaveBeenCalled();
  });

  it('deletes a repository and tolerates 404', async () => {
    const del = make(jest.fn(async () => ({ ok: true, status: 204 })));
    await expect(del.provider.deleteRepo(repository(), actor)).resolves.toBeUndefined();
    expect(del.installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
      permissions: { metadata: 'read', administration: 'write' },
    });
    const gone = make(jest.fn(async () => ({ ok: false, status: 404 })));
    await expect(gone.provider.deleteRepo(repository(), actor)).resolves.toBeUndefined();
    const err = make(jest.fn(async () => ({ ok: false, status: 500 })));
    await expect(err.provider.deleteRepo(repository(), actor)).rejects.toThrow('HTTP 500');
  });

  it('grants a collaborator the mapped permission and skips the owner', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 201 }));
    const { provider, installations } = make(fetchMock);
    await provider.setCollaborator(repository(), 'dev', 'viewer');
    expect(installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
      permissions: { metadata: 'read', administration: 'write' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/acme/api/collaborators/dev');
    expect(JSON.parse(init.body as string)).toEqual({ permission: 'pull' });
    // Owner is never added as their own collaborator.
    fetchMock.mockClear();
    await provider.setCollaborator(repository(), 'acme', 'admin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces stale retry tags and creates a new one at the sha', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ ref: 'refs/tags/initpad-retry-old' }]) }) // list
      .mockResolvedValueOnce({ ok: true, status: 204 }) // delete stale (deleteTag → new token + DELETE)
      .mockResolvedValueOnce({ ok: true, status: 201 }); // create
    const { provider } = make(fetchMock);
    const tag = await provider.createRetryTag(repository(), 'deadbeef', actor);
    expect(tag).toMatch(/^initpad-retry-/);
    const createCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [string, RequestInit];
    expect(createCall[0]).toContain('/repos/acme/api/git/refs');
    expect(JSON.parse(createCall[1].body as string).sha).toBe('deadbeef');
  });

  it('detaches by removing platform secrets and disabling Actions', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 }));
    const { provider } = make(fetchMock);
    await provider.detachRepo(repository(), actor);
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

  it('sealed-box encrypts GitHub Actions secrets with the repository public key', async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key_id: 'key-1', key: publicKey }),
      })
      .mockResolvedValue({ ok: true, status: 201 });
    config.auth.frontendUrl = 'https://initpad.example/';
    const { provider, installations } = make(fetchMock);

    await provider.configureRepoSecrets(repository(), 'unused-installation-token', 'deploy-secret');

    expect(installations.tokenForBinding).toHaveBeenCalledWith('installation-row-1', {
      permissions: { metadata: 'read', secrets: 'write' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4); // public key + 3 encrypted secrets
    const deployCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/actions/secrets/INITPAD_DEPLOY_TOKEN'),
    ) as unknown as [string, RequestInit];
    const body = JSON.parse(deployCall[1].body as string) as {
      encrypted_value: string;
      key_id: string;
    };
    const decrypted = sodium.crypto_box_seal_open(
      sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL),
      keyPair.publicKey,
      keyPair.privateKey,
      'text',
    );
    expect(decrypted).toBe('deploy-secret');
    expect(body.key_id).toBe('key-1');
  });

  it('uses the organization GHCR endpoint for organization installations', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 }));
    const { provider } = make(fetchMock);
    await provider.deletePackages(repository());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(
      '/orgs/acme/packages/container/api',
    );
  });
});
