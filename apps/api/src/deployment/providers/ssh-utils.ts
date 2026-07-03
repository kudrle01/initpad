import { Client, type SFTPWrapper } from 'ssh2';
import { createHash } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as tar from 'tar-fs';

// Sdílené helpery pro SSH/SFTP providery: promisifikované připojení, exec,
// SFTP, upload adresáře jako tar a rekurzivní upload souborů. Držíme je mimo
// providery, ať jsou samotné adaptéry čitelné.

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password: string;
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
        password: t.password,
        readyTimeout: timeoutMs,
      });
  });
  return conn;
}

// Spustí příkaz a posbírá výstup. Neselže na nenulovém exit kódu – to řeší volající.
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

// Zabalí lokální adresář do tar streamu a nahraje ho do vzdáleného souboru
// (bez node_modules/.git). Na druhé straně se rozbalí přes `tar xf` (fake-vps).
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

// Rekurzivně nahraje soubory (pro SFTP cíl bez shellu – atmoz/sftp). Vytváří
// vzdálené adresáře a přenáší jednotlivé soubory přes fastPut.
export async function uploadDir(
  sftp: SFTPWrapper,
  localDir: string,
  remoteDir: string,
  ignore: string[] = ['node_modules', '.git'],
): Promise<void> {
  await mkdirp(sftp, remoteDir);
  for (const entry of readdirSync(localDir)) {
    if (ignore.includes(entry)) continue;
    const localPath = join(localDir, entry);
    const remotePath = `${remoteDir}/${entry}`;
    if (statSync(localPath).isDirectory()) {
      await uploadDir(sftp, localPath, remotePath, ignore);
    } else {
      await fastPut(sftp, localPath, remotePath);
    }
  }
}

export function fastPut(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve())),
  );
}

// mkdir -p přes SFTP: zkouší vytvořit každou úroveň, existující ignoruje.
export async function mkdirp(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const parts = remoteDir.split('/').filter(Boolean);
  let path = remoteDir.startsWith('/') ? '' : '.';
  for (const part of parts) {
    path += '/' + part;
    await new Promise<void>((resolve) => sftp.mkdir(path, () => resolve()));
  }
}

export function sftpSymlink(sftp: SFTPWrapper, target: string, linkPath: string): Promise<void> {
  return new Promise((resolve, reject) =>
    // ssh2: symlink(targetPath, linkPath). Volající předává linkPath, na který
    // se target odkazuje.
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
          // mode & S_IFDIR (0o040000) → adresář
          isDir: (e.attrs.mode & 0o170000) === 0o040000,
        })),
      );
    }),
  );
}

export function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve) => sftp.rmdir(path, () => resolve()));
}

// Rekurzivní smazání vzdáleného adresáře (jen SFTP, bez shellu – pro atmoz/sftp).
export async function sftpRmrf(sftp: SFTPWrapper, path: string): Promise<void> {
  const entries = await sftpReaddir(sftp, path);
  for (const e of entries) {
    const child = `${path}/${e.name}`;
    if (e.isDir) await sftpRmrf(sftp, child);
    else await sftpUnlink(sftp, child);
  }
  await sftpRmdir(sftp, path);
}

export function sshEnd(conn: Client): void {
  try {
    conn.end();
  } catch {
    // spojení už mohlo spadnout – nevadí
  }
}

// Deterministický „slot" (0..slots-1) z názvu → stabilní port pro daný projekt.
export function portSlot(key: string, slots: number): number {
  const hash = createHash('sha1').update(key).digest();
  return hash[0] % Math.max(1, slots);
}
