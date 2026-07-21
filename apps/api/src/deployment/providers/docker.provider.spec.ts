import { createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import * as tarStream from 'tar-stream';
// The archive identity check is daemon-free and now lives in the artifacts module
// (ADR-059 P1.4); DockerProvider.loadImageArchive delegates to it. Tests stay here
// to preserve the Docker-ingest boundary contract they were written for.
import { assertImageArchiveIdentity } from '../../artifacts/image-archive';

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
