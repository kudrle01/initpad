import { readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Every temporary directory the API creates starts with this prefix.
const WORK_PREFIX = 'initpad-';

/**
 * Removes working files that an interrupted deployment left behind (ADR-172).
 * In the self-hosted profile os.tmpdir() is a disk volume that survives API
 * restarts, unlike a tmpfs. It runs before the API accepts any work, so no
 * entry is in use. Only entries with the API's own prefix are touched.
 */
export function clearStaleWorkFiles(dir: string = tmpdir()): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(WORK_PREFIX)) continue;
    try {
      rmSync(join(dir, entry), { recursive: true, force: true });
      removed.push(entry);
    } catch {
      // A file that cannot be removed only costs disk space.
    }
  }
  return removed;
}
