import { Client, type SFTPWrapper } from 'ssh2';
import { createHash } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as tar from 'tar-fs';

/**
 * Shared helpers for the SSH/SFTP providers: promisified connect/exec/SFTP,
 * directory upload (as a tar stream or file-by-file) and remote file-system
 * utilities. Kept outside the providers so the adapters themselves stay
 * focused on deployment logic.
 */

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  // PEM private key (custom targets that authenticate by key instead of password).
  privateKey?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function sshConnect(t: SshTarget, timeoutMs = 8000): Promise<Client> {
  const conn = new Client();
  await new Promise<void>((resolve, reject) => {
    conn
      .on('ready', () => resolve())
      .on('error', (err) => reject(err))
      .connect({
        host: t.host,
        port: t.port,
        username: t.username,
        ...(t.privateKey ? { privateKey: t.privateKey } : { password: t.password }),
        readyTimeout: timeoutMs,
      });
  });
  return conn;
}

// Runs a command and collects its output. Does not throw on a non-zero exit
// code — that decision belongs to the caller.
export function sshExec(conn: Client, cmd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code: number | null) =>
          resolve({ code: code ?? 0, stdout, stderr }),
        )
        .on('data', (d: Buffer) => (stdout += d.toString()))
        .stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    });
  });
}

export function getSftp(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) =>
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))),
  );
}

// Packs a local directory into a tar stream and uploads it to a remote file
// (node_modules/.git excluded). The remote side extracts it with `tar xf`.
export function uploadTar(
  sftp: SFTPWrapper,
  localDir: string,
  remoteFile: string,
  ignore: string[] = ['node_modules', '.git'],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack(localDir, {
      ignore: (name) => ignore.some((i) => name.split(/[/\\]/).includes(i)),
    });
    const ws = sftp.createWriteStream(remoteFile);
    ws.on('close', () => resolve());
    ws.on('error', reject);
    pack.on('error', reject);
    pack.pipe(ws);
  });
}

// Recursively uploads files one by one — required for SFTP-only targets with
// no shell access (atmoz/sftp), where a remote tar extract is not possible.
export async function uploadDir(
  sftp: SFTPWrapper,
  localDir: string,
  remoteDir: string,
  ignore: string[] = ['node_modules', '.git'],
  onFile?: () => void,
): Promise<void> {
  await mkdirp(sftp, remoteDir);
  for (const entry of readdirSync(localDir)) {
    if (ignore.includes(entry)) continue;
    const localPath = join(localDir, entry);
    const remotePath = `${remoteDir}/${entry}`;
    if (statSync(localPath).isDirectory()) {
      await uploadDir(sftp, localPath, remotePath, ignore, onFile);
    } else {
      await fastPut(sftp, localPath, remotePath);
      onFile?.();
    }
  }
}

export function fastPut(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve())),
  );
}

// `mkdir -p` over SFTP: attempts to create each path level. A mkdir error is
// tolerated only when the directory actually exists (verified via stat);
// other failures (permissions, read-only FS) propagate immediately instead of
// surfacing later as a confusing upload error.
export async function mkdirp(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const parts = remoteDir.split('/').filter(Boolean);
  let path = remoteDir.startsWith('/') ? '' : '.';
  for (const part of parts) {
    path += '/' + part;
    const current = path;
    await new Promise<void>((resolve, reject) =>
      sftp.mkdir(current, (err) => {
        if (!err) return resolve();
        sftp.stat(current, (statErr) =>
          statErr
            ? reject(new Error(`mkdir ${current} failed: ${err.message}`))
            : resolve(),
        );
      }),
    );
  }
}

export function sftpSymlink(sftp: SFTPWrapper, target: string, linkPath: string): Promise<void> {
  return new Promise((resolve, reject) =>
    // ssh2 signature: symlink(targetPath, linkPath) — linkPath is the symlink
    // being created, target is what it points to.
    sftp.symlink(target, linkPath, (err) => (err ? reject(err) : resolve())),
  );
}

export function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve) => sftp.unlink(path, () => resolve()));
}

export function sftpRename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.rename(from, to, (err) => (err ? reject(err) : resolve())),
  );
}

export interface RemoteEntry {
  name: string;
  isDir: boolean;
}

export function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<RemoteEntry[]> {
  return new Promise((resolve) =>
    sftp.readdir(path, (err, list) => {
      if (err || !list) return resolve([]);
      resolve(
        list.map((e) => ({
          name: e.filename,
          // mode & S_IFMT (0o170000) === S_IFDIR (0o040000) → directory
          isDir: (e.attrs.mode & 0o170000) === 0o040000,
        })),
      );
    }),
  );
}

export function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve) => sftp.rmdir(path, () => resolve()));
}

// Recursive removal of a remote directory using SFTP operations only
// (no shell available on atmoz/sftp targets).
export async function sftpRmrf(sftp: SFTPWrapper, path: string): Promise<void> {
  const entries = await sftpReaddir(sftp, path);
  for (const e of entries) {
    const child = `${path}/${e.name}`;
    if (e.isDir) await sftpRmrf(sftp, child);
    else await sftpUnlink(sftp, child);
  }
  await sftpRmdir(sftp, path);
}

// Best-effort chmod over SFTP (setstat). Errors are swallowed — some servers
// disallow it, and it must never fail the deployment.
export function sftpSetMode(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
  return new Promise((resolve) => sftp.setstat(path, { mode }, () => resolve()));
}

// Recursively makes an uploaded tree web-readable (dirs 0755, files 0644) so a
// web server running as a different user (real shared hosting) can serve it.
export async function sftpChmodTree(
  sftp: SFTPWrapper,
  path: string,
  fileMode = 0o644,
  dirMode = 0o755,
): Promise<void> {
  await sftpSetMode(sftp, path, dirMode);
  for (const e of await sftpReaddir(sftp, path)) {
    const child = `${path}/${e.name}`;
    if (e.isDir) await sftpChmodTree(sftp, child, fileMode, dirMode);
    else await sftpSetMode(sftp, child, fileMode);
  }
}

export function sshEnd(conn: Client): void {
  try {
    conn.end();
  } catch {
    // The connection may already be gone — nothing to do.
  }
}

// Deterministic slot (0..slots-1) derived from a key — gives each project a
// stable port on the shared SSH target.
export function portSlot(key: string, slots: number): number {
  const hash = createHash('sha1').update(key).digest();
  return hash[0] % Math.max(1, slots);
}
