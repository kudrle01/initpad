import { execFile } from 'child_process';
import { promisify } from 'util';
import { createReadStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as tar from 'tar-fs';

const exec = promisify(execFile);
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export interface ExportedSource {
  dir: string;
  cleanup: () => void;
}

/**
 * Exports the EXACT commit (via `git archive`) from a local repository into
 * a temporary directory.
 *
 * The platform primarily downloads sources from Gitea (the source of truth,
 * see GiteaService.downloadArchive); this local export is the fallback for
 * legacy projects that still have a working copy on disk. Deploying an exact
 * commit — never a possibly-newer working tree — mirrors the "build once,
 * deploy many" guarantee of the Docker/registry path at the source level.
 *
 * Returns null when the version is not a commit of the repository (e.g. the
 * bootstrap version) or the repository does not exist locally.
 */
export async function exportVersion(
  repoPath: string,
  version: string,
): Promise<ExportedSource | null> {
  if (!SHA_RE.test(version)) return null;
  try {
    await exec('git', ['-C', repoPath, 'cat-file', '-e', `${version}^{commit}`]);
  } catch {
    return null; // not a commit of this repository
  }

  const base = mkdtempSync(join(tmpdir(), 'initpad-src-'));
  const cleanup = () => rmSync(base, { recursive: true, force: true });
  try {
    const tarPath = join(base, 'src.tar');
    // `git archive` omits .git and honours .gitattributes — an ideal export.
    await exec('git', ['-C', repoPath, 'archive', '--format=tar', '-o', tarPath, version]);
    const dir = join(base, 'src');
    await new Promise<void>((resolve, reject) => {
      const extract = createReadStream(tarPath).pipe(tar.extract(dir));
      extract.on('finish', () => resolve());
      extract.on('error', reject);
    });
    rmSync(tarPath, { force: true });
    return { dir, cleanup };
  } catch {
    cleanup();
    return null;
  }
}
