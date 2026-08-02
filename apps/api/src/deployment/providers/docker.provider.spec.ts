import { createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import * as tarStream from 'tar-stream';
// The archive identity check is daemon-free and now lives in the artifacts module
// (ADR-059 P1.4); DockerProvider.loadImageArchive delegates to it. Tests stay here
// to preserve the Docker-ingest boundary contract they were written for.
import { assertImageArchiveIdentity } from '../../artifacts/image-archive';
import {
  DockerProvider,
  dockerContainerName,
  dockerNetworkName,
} from './docker.provider';

type Manifest = { Config?: string; RepoTags?: string[]; Layers?: string[] };

async function imageArchive(
  entries: Array<{ name: string; body: string | Buffer }>,
): Promise<{ path: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'initpad-docker-archive-test-'));
  const path = join(dir, 'image.tar');
  const pack = tarStream.pack();
  const output = createWriteStream(path);
  pack.pipe(output);
  for (const e of entries) pack.entry({ name: e.name }, e.body);
  pack.finalize();
  await finished(output);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function standard(repoTags: string[]): Array<{ name: string; body: string }> {
  const manifest: Manifest[] = [{ Config: 'config.json', RepoTags: repoTags, Layers: ['layer.tar'] }];
  return [
    { name: 'manifest.json', body: JSON.stringify(manifest) },
    { name: 'config.json', body: '{}' },
    { name: 'layer.tar', body: '' },
  ];
}

describe('assertImageArchiveIdentity (Docker ingest boundary)', () => {
  const expected = 'ghcr.io/acme/api:' + 'a'.repeat(40);

  it('accepts one image with exactly the expected immutable tag', async () => {
    const archive = await imageArchive(standard([expected]));
    try {
      await expect(assertImageArchiveIdentity(archive.path, expected)).resolves.toBeUndefined();
    } finally {
      archive.cleanup();
    }
  });

  it('rejects an archive that could overwrite an unrelated image tag', async () => {
    const archive = await imageArchive(standard([expected, 'initpad/control-plane:latest']));
    try {
      await expect(assertImageArchiveIdentity(archive.path, expected)).rejects.toThrow(
        'exactly the expected tag',
      );
    } finally {
      archive.cleanup();
    }
  });

  it('rejects a tag other than the expected one', async () => {
    const archive = await imageArchive(standard(['ghcr.io/acme/api:' + 'b'.repeat(40)]));
    try {
      await expect(assertImageArchiveIdentity(archive.path, expected)).rejects.toThrow(
        'exactly the expected tag',
      );
    } finally {
      archive.cleanup();
    }
  });

  it('rejects an archive with no Docker manifest', async () => {
    const archive = await imageArchive([{ name: 'config.json', body: '{}' }]);
    try {
      await expect(assertImageArchiveIdentity(archive.path, expected)).rejects.toThrow(
        'no Docker manifest',
      );
    } finally {
      archive.cleanup();
    }
  });

  it('rejects a duplicate manifest.json', async () => {
    const archive = await imageArchive([
      ...standard([expected]),
      { name: 'manifest.json', body: JSON.stringify([{ RepoTags: [expected] }]) },
    ]);
    try {
      await expect(assertImageArchiveIdentity(archive.path, expected)).rejects.toThrow(
        'duplicate Docker manifests',
      );
    } finally {
      archive.cleanup();
    }
  });

  it('rejects an invalid manifest JSON', async () => {
    const archive = await imageArchive([{ name: 'manifest.json', body: 'not-json' }]);
    try {
      await expect(assertImageArchiveIdentity(archive.path, expected)).rejects.toThrow(
        'invalid Docker manifest',
      );
    } finally {
      archive.cleanup();
    }
  });
});

describe('DockerProvider config-var injection (ADR-061)', () => {
  function providerWithMockDaemon() {
    const created: Array<Record<string, unknown>> = [];
    const provider = new DockerProvider();
    (provider as unknown as { docker: unknown }).docker = {
      createContainer: jest.fn(async (opts: Record<string, unknown>) => {
        created.push(opts);
        return {
          start: jest.fn(async () => undefined),
          inspect: jest.fn(async () => ({
            NetworkSettings: { Ports: { '3000/tcp': [{ HostPort: '12345' }] } },
          })),
          remove: jest.fn(async () => undefined),
        };
      }),
    };
    return { provider, created };
  }

  it('injects config vars into the container Env', async () => {
    const { provider, created } = providerWithMockDaemon();
    const port = await (provider as unknown as {
      runContainer: (i: string, n: string, net: string, p: number, project: string, env: string, vars?: Record<string, string>) => Promise<string>;
    }).runContainer('img', 'name', 'net-dev', 3000, 'acme-api', 'dev', { GREETING: 'ahoj', TOKEN: 's3cr3t' });
    expect(port).toBe('12345');
    expect(created[0].Env).toEqual(['GREETING=ahoj', 'TOKEN=s3cr3t']);
    expect(created[0].Labels).toEqual(expect.objectContaining({
      'com.initpad.project': 'acme-api',
      'com.initpad.environment': 'dev',
    }));
  });

  it('omits Env when there are no config vars', async () => {
    const { provider, created } = providerWithMockDaemon();
    await (provider as unknown as {
      runContainer: (i: string, n: string, net: string, p: number, project: string, env: string) => Promise<string>;
    }).runContainer('img', 'name', 'net-dev', 3000, 'acme-api', 'dev');
    expect(created[0].Env).toBeUndefined();
  });
});

describe('DockerProvider allocation isolation (ADR-060)', () => {
  it('uses workspace-scoped network and container names with a legacy fallback', () => {
    expect(dockerNetworkName('dev', 'Team Alpha')).toBe('net-team-alpha-dev');
    expect(dockerNetworkName('dev')).toBe('net-dev');
    expect(dockerContainerName('alice-api', 'dev', 'Team Alpha'))
      .toBe('initpad-team-alpha-alice-api-dev');
    expect(dockerContainerName('alice-api', 'dev')).toBe('initpad-alice-api-dev');
  });
});

describe('DockerProvider registry diagnostics', () => {
  it('surfaces the daemon pull failure instead of claiming the image is absent', async () => {
    const provider = new DockerProvider();
    const internals = provider as unknown as {
      isAvailable: () => Promise<boolean>;
      ensureNetwork: () => Promise<void>;
      imageExists: () => Promise<boolean>;
      tryPull: () => Promise<{ ok: false; error: string }>;
    };
    internals.isAvailable = jest.fn(async () => true);
    internals.ensureNetwork = jest.fn(async () => undefined);
    internals.imageExists = jest.fn(async () => false);
    internals.tryPull = jest.fn(async () => ({
      ok: false as const,
      error: 'dial tcp [::1]:3001: connect: connection refused',
    }));

    await expect(provider.deploy({
      projectName: 'acme-api',
      version: 'a'.repeat(40),
      env: 'dev',
      repoPath: '/unused',
      imageRef: `127.0.0.1:3001/acme/api:${'a'.repeat(40)}`,
      allowBuildFallback: false,
    })).resolves.toEqual({
      status: 'failed',
      url: '',
      reason: expect.stringContaining('dial tcp [::1]:3001: connect: connection refused'),
    });
  });

  it('prunes only unused older tags from the same repository', async () => {
    const removed: string[] = [];
    const provider = new DockerProvider();
    (provider as unknown as { docker: unknown }).docker = {
      listContainers: jest.fn(async () => [{ ImageID: 'sha256:used' }]),
      listImages: jest.fn(async () => [
        {
          Id: 'sha256:current',
          RepoTags: ['127.0.0.1:3001/acme/api:new'],
        },
        {
          Id: 'sha256:stale',
          RepoTags: ['127.0.0.1:3001/acme/api:old'],
        },
        {
          Id: 'sha256:used',
          RepoTags: ['127.0.0.1:3001/acme/api:promoted'],
        },
        {
          Id: 'sha256:other',
          RepoTags: ['127.0.0.1:3001/other/app:old'],
        },
      ]),
      getImage: jest.fn((tag: string) => ({
        remove: jest.fn(async () => {
          removed.push(tag);
          return [{ Untagged: tag }];
        }),
      })),
    };

    await (provider as unknown as {
      pruneUnusedRepositoryImages: (ref: string) => Promise<void>;
    }).pruneUnusedRepositoryImages('127.0.0.1:3001/acme/api:new');

    expect(removed).toEqual(['127.0.0.1:3001/acme/api:old']);
  });
});
