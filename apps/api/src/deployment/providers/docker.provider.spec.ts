import { createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import * as tarStream from 'tar-stream';
import { DockerProvider } from './docker.provider';

async function imageArchive(repoTags: string[]): Promise<{ path: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'initpad-docker-archive-test-'));
  const path = join(dir, 'image.tar');
  const pack = tarStream.pack();
  const output = createWriteStream(path);
  pack.pipe(output);
  pack.entry(
    { name: 'manifest.json' },
    JSON.stringify([{ Config: 'config.json', RepoTags: repoTags, Layers: ['layer.tar'] }]),
  );
  pack.entry({ name: 'config.json' }, '{}');
  pack.entry({ name: 'layer.tar' }, Buffer.alloc(0));
  pack.finalize();
  await finished(output);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('DockerProvider image archive boundary', () => {
  it('accepts one image with exactly the expected immutable tag', async () => {
    const archive = await imageArchive(['ghcr.io/acme/api:' + 'a'.repeat(40)]);
    const provider = new DockerProvider();
    try {
      await expect((provider as any).assertArchiveIdentity(
        archive.path,
        'ghcr.io/acme/api:' + 'a'.repeat(40),
      )).resolves.toBeUndefined();
    } finally {
      archive.cleanup();
    }
  });

  it('rejects an archive that could overwrite an unrelated image tag', async () => {
    const expected = 'ghcr.io/acme/api:' + 'a'.repeat(40);
    const archive = await imageArchive([expected, 'initpad/control-plane:latest']);
    const provider = new DockerProvider();
    try {
      await expect((provider as any).assertArchiveIdentity(archive.path, expected))
        .rejects.toThrow('exactly the expected tag');
    } finally {
      archive.cleanup();
    }
  });
});
