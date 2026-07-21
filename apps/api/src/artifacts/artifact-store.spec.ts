import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { artifactObjectKey } from './artifact-store';
import { InMemoryArtifactStore } from './in-memory-artifact-store';

describe('artifactObjectKey', () => {
  const base = {
    workspaceId: 'ws_1',
    projectId: 'proj_1',
    artifactId: 'art_1',
    digest: 'sha256:abc123',
  };

  it('builds a stable, tenant-scoped key from internal IDs and the digest', () => {
    expect(artifactObjectKey(base)).toBe('artifacts/ws_1/proj_1/art_1/sha256-abc123.tar');
  });

  it('isolates tenants: different workspaces never collide on a key', () => {
    const a = artifactObjectKey({ ...base, workspaceId: 'ws_a' });
    const b = artifactObjectKey({ ...base, workspaceId: 'ws_b' });
    expect(a).not.toEqual(b);
  });

  it('is deterministic for the same inputs', () => {
    expect(artifactObjectKey(base)).toEqual(artifactObjectKey({ ...base }));
  });

  it('sanitises unsafe characters out of every component', () => {
    const key = artifactObjectKey({
      workspaceId: 'ws/../evil',
      projectId: 'proj 1',
      artifactId: 'art#1',
      digest: 'sha256:AABBCC',
    });
    expect(key).toBe('artifacts/ws-.-evil/proj-1/art-1/sha256-AABBCC.tar');
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(5);
  });

  it('rejects missing or blank components', () => {
    expect(() => artifactObjectKey({ ...base, artifactId: '' })).toThrow();
    expect(() => artifactObjectKey({ ...base, digest: '   ' })).toThrow();
  });
});

describe('InMemoryArtifactStore', () => {
  let store: InMemoryArtifactStore;
  let dir: string;

  beforeEach(async () => {
    store = new InMemoryArtifactStore();
    dir = await mkdtemp(join(tmpdir(), 'artifact-store-'));
  });

  it('round-trips a file through put/getToFile', async () => {
    const src = join(dir, 'image.tar');
    const dest = join(dir, 'out.tar');
    await writeFile(src, 'payload-bytes');

    await store.put('artifacts/ws/pr/ar/d.tar', src);
    expect(store.has('artifacts/ws/pr/ar/d.tar')).toBe(true);
    expect(await store.head('artifacts/ws/pr/ar/d.tar')).toEqual({ sizeBytes: 13 });

    await store.getToFile('artifacts/ws/pr/ar/d.tar', dest);
    expect((await readFile(dest)).toString()).toBe('payload-bytes');
  });

  it('reports a missing object via head() rather than throwing', async () => {
    expect(await store.head('nope')).toBeNull();
  });

  it('throws when getToFile targets a missing object', async () => {
    await expect(store.getToFile('nope', join(dir, 'x'))).rejects.toThrow(/not found/);
  });

  it('delete is idempotent', async () => {
    await expect(store.delete('nope')).resolves.toBeUndefined();
  });

  it('presignGet returns a bounded, key-scoped URL', async () => {
    const url = await store.presignGet('artifacts/ws/pr/ar/d.tar', 120);
    expect(url).toContain('ttl=120');
    expect(url).toContain(encodeURIComponent('artifacts/ws/pr/ar/d.tar'));
  });
});
