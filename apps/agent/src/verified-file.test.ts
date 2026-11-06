import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readVerifiedFile } from './verified-file.js';

test('reads a file after checking the descriptor it reads from', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verified-file-'));
  const path = join(directory, 'plan.json');
  await writeFile(path, '{"ok":true}', { mode: 0o600 });
  let checkedSize = -1;
  const raw = await readVerifiedFile(path, (stat) => (checkedSize = stat.size), 'symlink');
  assert.equal(raw, '{"ok":true}');
  assert.equal(checkedSize, raw.length);
});

test('refuses a symlink instead of following it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verified-file-'));
  const target = join(directory, 'target.json');
  const link = join(directory, 'link.json');
  await writeFile(target, '{}', { mode: 0o600 });
  await symlink(target, link);
  await assert.rejects(
    readVerifiedFile(link, () => undefined, 'not a regular file'),
    /not a regular file/,
  );
});

test('does not read a file the check rejects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verified-file-'));
  const path = join(directory, 'plan.json');
  await writeFile(path, '{}', { mode: 0o644 });
  await assert.rejects(
    readVerifiedFile(
      path,
      (stat) => {
        if ((stat.mode & 0o077) !== 0) throw new Error('too broad');
      },
      'symlink',
    ),
    /too broad/,
  );
});
