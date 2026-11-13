import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearStaleWorkFiles } from './work-dir';

describe('clearStaleWorkFiles', () => {
  it('removes only the API working entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-dir-spec-'));
    mkdirSync(join(dir, 'initpad-registry-artifact-abc'));
    writeFileSync(join(dir, 'initpad-registry-artifact-abc', 'image.tar'), 'x');
    writeFileSync(join(dir, 'initpad-src-def'), 'x');
    writeFileSync(join(dir, 'unrelated.txt'), 'x');

    const removed = clearStaleWorkFiles(dir);

    expect(removed.sort()).toEqual(['initpad-registry-artifact-abc', 'initpad-src-def']);
    expect(existsSync(join(dir, 'initpad-registry-artifact-abc'))).toBe(false);
    expect(existsSync(join(dir, 'unrelated.txt'))).toBe(true);
  });

  it('ignores a missing directory', () => {
    expect(clearStaleWorkFiles(join(tmpdir(), 'initpad-work-dir-missing-xyz'))).toEqual([]);
  });
});
