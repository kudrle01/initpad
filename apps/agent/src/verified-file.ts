import { constants, open, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

/**
 * Reads a file only after checking the metadata of the very file descriptor it
 * reads from. A separate lstat() followed by readFile() on the path lets the
 * file be swapped for a symlink or another file between the check and the read.
 * O_NOFOLLOW refuses a symlink in the last component and O_NONBLOCK keeps a
 * planted FIFO from blocking the open.
 */
export async function readVerifiedFile(
  path: string,
  verify: (stat: Stats) => void,
  symlinkMessage: string,
): Promise<string> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(symlinkMessage, { cause: error });
    }
    throw error;
  }
  try {
    verify(await handle.stat());
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}
