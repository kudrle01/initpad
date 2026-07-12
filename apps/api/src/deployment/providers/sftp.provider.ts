import { Injectable, Logger } from '@nestjs/common';
import type { Client, SFTPWrapper } from 'ssh2';
import { exec } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { ProviderKind } from '../../domain/types';
import { config } from '../../config';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
  ProviderConnection,
  StartInput,
  TeardownInput,
  VerifyResult,
} from '../deployment-provider.interface';
import {
  getSftp,
  mkdirp,
  sftpChmodTree,
  sftpReaddir,
  sftpRename,
  sftpRmrf,
  sftpSymlink,
  sftpUnlink,
  sshConnect,
  sshEnd,
  sshExec,
  uploadDir,
  uploadTar,
} from './ssh-utils';

const execAsync = promisify(exec);

// Effective connection for one call: the user's custom target (prod), or the
// platform's built-in demo target (fake-sftp + nginx).
interface EffCfg {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  remoteRoot: string;
  publicUrl: string;
  internalUrl: string;
  artifactSubdir: string;
  // A user's own server (vs. the built-in fake-sftp + nginx). Real shared
  // hosting often blocks symlink-following and serves as a different user, so
  // custom targets upload straight into the served folder with web-readable
  // permissions instead of the releases+symlink scheme.
  custom: boolean;
}

/**
 * Deploys a static / PHP application over SFTP.
 *
 * Two kinds of target:
 *  - demo (no connection): the fake-sftp container served by nginx;
 *  - custom (input.connection): the user's own SFTP host (e.g. a school server
 *    such as ESO that also runs PHP), configured via a form in the UI.
 *
 * Layout is namespaced per project+environment so deployments never overwrite
 * each other: <root>/<slug>-releases/<version> plus a <root>/<slug> symlink to
 * the current version (atomic release switch). The site is served at
 * <publicUrl>/<slug>/.
 */
@Injectable()
export class SftpProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'sftp';
  private readonly logger = new Logger('SftpProvider');

  private eff(input: { connection?: ProviderConnection }): EffCfg {
    if (input.connection) {
      const c = input.connection;
      const base = c.publicUrl.replace(/\/+$/, '');
      return {
        host: c.host,
        port: c.port,
        username: c.username,
        password: c.password,
        privateKey: c.privateKey,
        remoteRoot: c.remoteRoot.replace(/\/+$/, ''),
        publicUrl: base,
        internalUrl: base, // the user's server is reachable directly
        artifactSubdir: '',
        custom: true,
      };
    }
    return { ...config.providers.sftp, custom: false };
  }

  // Test connection: open SFTP and confirm the web root is writable.
  async verify(connection?: ProviderConnection): Promise<VerifyResult> {
    const cfg = this.eff({ connection });
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch (e) {
      return { ok: false, message: `Cannot connect to ${cfg.host}:${cfg.port} — ${(e as Error).message}` };
    }
    try {
      const sftp = await getSftp(conn);
      await mkdirp(sftp, cfg.remoteRoot);
      return { ok: true, message: `Connected to ${cfg.host} over SFTP. Web root ${cfg.remoteRoot} is writable.` };
    } catch (e) {
      return { ok: false, message: `Connected, but ${cfg.remoteRoot} is not writable: ${(e as Error).message}` };
    } finally {
      sshEnd(conn);
    }
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const cfg = this.eff(input);
    const slug = this.slug(input);
    const version = this.sanitize(input.version) || 'latest';
    const release = `${cfg.remoteRoot}/${slug}-releases/${version}`;

    // Build the static artifact if the template needs it (e.g. React → dist).
    if (input.buildCommand) {
      this.logger.log(`Building static artifact: ${input.buildCommand}`);
      try {
        await execAsync(input.buildCommand, {
          cwd: input.repoPath,
          timeout: 180_000,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (e) {
        const detail = (e as Error).message.split('\n').slice(-4).join(' ').trim();
        return { status: 'failed', url: '', reason: `Build failed: ${detail}` };
      }
    }

    const artifactDir = input.artifactDir ?? cfg.artifactSubdir;
    const localDir = artifactDir ? join(input.repoPath, artifactDir) : input.repoPath;
    if (!existsSync(localDir)) {
      return {
        status: 'failed',
        url: '',
        reason: `Artifact directory '${artifactDir || '.'}' does not exist in the deployed version.`,
      };
    }

    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch (e) {
      const reason = `Cannot reach SFTP host ${cfg.host}:${cfg.port} (${(e as Error).message})`;
      this.logger.warn(reason);
      return { status: 'failed', url: '', reason };
    }

    try {
      const sftp = await getSftp(conn);
      if (cfg.custom) {
        await this.uploadCustom(conn, sftp, cfg, slug, localDir, input);
      } else {
        // Built-in fake-sftp + nginx: atomic release switch via a symlink.
        await mkdirp(sftp, release);
        await uploadDir(sftp, localDir, release);
        await this.swapLink(sftp, cfg.remoteRoot, slug, `${slug}-releases/${version}`);
      }

      input.onProgress?.('Verifying deployment');
      const url = this.publicUrl(cfg, slug, input.webRoot);
      const reachable = await this.waitReachable(this.internalUrl(cfg, slug, input.webRoot));
      if (!reachable) {
        return {
          status: 'failed',
          url,
          reason: `Files uploaded, but ${url} is not serving them (is the web server up / the public URL correct?).`,
        };
      }
      this.logger.log(`Deployed over SFTP: ${input.projectName} (${input.env}) → ${url}`);
      return { status: 'running', url };
    } catch (e) {
      return { status: 'failed', url: '', reason: (e as Error).message };
    } finally {
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<void> {
    const cfg = this.eff(input);
    const slug = this.slug(input);
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch {
      return;
    }
    try {
      const sftp = await getSftp(conn);
      if (cfg.custom) {
        // Real host: the served folder is a real directory (no releases/symlink).
        if (await this.execWorks(conn)) {
          await sshExec(
            conn,
            `rm -rf ${cfg.remoteRoot}/${slug} ${cfg.remoteRoot}/${slug}__deploying ${cfg.remoteRoot}/${slug}.deploy.tar`,
          );
        } else {
          await sftpRmrf(sftp, `${cfg.remoteRoot}/${slug}`);
        }
      } else {
        await sftpUnlink(sftp, `${cfg.remoteRoot}/${slug}`);
        await sftpRmrf(sftp, `${cfg.remoteRoot}/${slug}-releases`);
      }
      this.logger.log(`Torn down SFTP deploy: ${input.projectName} (${input.env})`);
    } finally {
      sshEnd(conn);
    }
  }

  async logs(): Promise<string> {
    return 'Static hosting has no process logs. Files are served by the web server from the published release.';
  }

  async stop(input: TeardownInput): Promise<void> {
    const cfg = this.eff(input);
    const slug = this.slug(input);
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch {
      return;
    }
    try {
      const sftp = await getSftp(conn);
      await sftpUnlink(sftp, `${cfg.remoteRoot}/${slug}`);
      this.logger.log(`SFTP site unpublished: ${slug}`);
    } finally {
      sshEnd(conn);
    }
  }

  async start(input: StartInput): Promise<DeployResult> {
    const cfg = this.eff(input);
    const slug = this.slug(input);
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch (e) {
      return { status: 'failed', url: '', reason: `Cannot reach SFTP host (${(e as Error).message})` };
    }
    try {
      const sftp = await getSftp(conn);
      let version = input.version ? this.sanitize(input.version) : '';
      if (!version) {
        const entries = await sftpReaddir(sftp, `${cfg.remoteRoot}/${slug}-releases`);
        const dirs = entries.filter((e) => e.isDir).map((e) => e.name).sort();
        version = dirs[dirs.length - 1] ?? '';
      }
      if (!version) {
        return { status: 'failed', url: '', reason: 'No release to start — use Redeploy first.' };
      }
      await this.swapLink(sftp, cfg.remoteRoot, slug, `${slug}-releases/${version}`);
      const url = this.publicUrl(cfg, slug);
      const reachable = await this.waitReachable(this.internalUrl(cfg, slug));
      return reachable
        ? { status: 'running', url }
        : { status: 'failed', url, reason: `${url} is not serving.` };
    } finally {
      sshEnd(conn);
    }
  }

  private async swapLink(
    sftp: SFTPWrapper,
    remoteRoot: string,
    name: string,
    target: string,
  ): Promise<void> {
    const link = `${remoteRoot}/${name}`;
    await sftpUnlink(sftp, link); // best-effort; the link may not exist yet
    await sftpSymlink(sftp, target, link);
  }

  private slug(input: { projectName: string; env: string }): string {
    return this.sanitize(`${input.projectName}-${input.env}`).toLowerCase();
  }

  // Served path: <slug>/ or, for frameworks with a public docroot subfolder,
  // <slug>/<webRoot>/ (e.g. Nette's www/).
  private servedSuffix(slug: string, webRoot?: string): string {
    const wr = webRoot ? `${webRoot.replace(/^\/+|\/+$/g, '')}/` : '';
    return `${slug}/${wr}`;
  }

  private publicUrl(cfg: EffCfg, slug: string, webRoot?: string): string {
    return `${cfg.publicUrl.replace(/\/+$/, '')}/${this.servedSuffix(slug, webRoot)}`;
  }

  private internalUrl(cfg: EffCfg, slug: string, webRoot?: string): string {
    return `${cfg.internalUrl.replace(/\/+$/, '')}/${this.servedSuffix(slug, webRoot)}`;
  }

  private async waitReachable(url: string): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(url);
        if (res.ok) return true;
      } catch {
        // not up yet — retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  // Uploads a local tree into the served folder on a user's server. Prefers a
  // single tar + remote extract (fast and robust — one transfer instead of
  // thousands of round-trips) when the host allows shell exec; falls back to
  // file-by-file SFTP for SFTP-only (chrooted) hosts.
  private async uploadCustom(
    conn: Client,
    sftp: SFTPWrapper,
    cfg: EffCfg,
    slug: string,
    localDir: string,
    input: DeployInput,
  ): Promise<void> {
    const dest = `${cfg.remoteRoot}/${slug}`;
    const staging = `${dest}__deploying`;
    const writable = (input.writableDirs ?? []).map((d) => d.replace(/^\/+|\/+$/g, ''));

    if (await this.execWorks(conn)) {
      const tarPath = `${cfg.remoteRoot}/${slug}.deploy.tar`;
      input.onProgress?.('Uploading archive');
      await uploadTar(sftp, localDir, tarPath);
      input.onProgress?.('Extracting on the server');
      await sshExec(conn, `rm -rf ${staging} && mkdir -p ${staging}`);
      const ex = await sshExec(conn, `tar xf ${tarPath} -C ${staging}`);
      await sshExec(conn, `rm -f ${tarPath}`);
      if (ex.code !== 0) {
        throw new Error(`Remote extract failed: ${(ex.stderr || ex.stdout).trim().slice(-300)}`);
      }
      // Web-readable: files get +r, directories +rx (traversable). Runtime dirs
      // (Nette temp/log …) world-writable.
      await sshExec(conn, `chmod -R a+rX ${staging}`);
      for (const d of writable) await sshExec(conn, `chmod -R 0777 ${staging}/${d} 2>/dev/null; true`);
      input.onProgress?.('Publishing');
      const swap = await sshExec(conn, `rm -rf ${dest} && mv ${staging} ${dest}`);
      if (swap.code !== 0) {
        throw new Error(`Remote publish failed: ${(swap.stderr || swap.stdout).trim().slice(-300)}`);
      }
      return;
    }

    // SFTP-only host (no shell): upload file-by-file. Slower, but works.
    await sftpRmrf(sftp, staging);
    await mkdirp(sftp, staging);
    const total = this.countFiles(localDir);
    let done = 0;
    input.onProgress?.(`Uploading 0/${total} files`);
    await uploadDir(sftp, localDir, staging, undefined, () => {
      done += 1;
      if (done % 25 === 0 || done === total) input.onProgress?.(`Uploading ${done}/${total} files`);
    });
    input.onProgress?.('Setting permissions');
    await sftpChmodTree(sftp, staging);
    for (const d of writable) {
      await sftpChmodTree(sftp, `${staging}/${d}`, 0o777, 0o777).catch(() => undefined);
    }
    await sftpRmrf(sftp, dest);
    await sftpRename(sftp, staging, dest);
  }

  // Whether the connection allows running shell commands (chrooted SFTP-only
  // hosts do not).
  private async execWorks(conn: Client): Promise<boolean> {
    try {
      const r = await sshExec(conn, 'echo ok');
      return r.code === 0 && r.stdout.includes('ok');
    } catch {
      return false;
    }
  }

  private sanitize(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }

  // Counts files in a local tree (for upload progress). Cheap — local FS.
  private countFiles(dir: string, ignore: string[] = ['node_modules', '.git']): number {
    let n = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (ignore.includes(e.name)) continue;
      n += e.isDirectory() ? this.countFiles(join(dir, e.name), ignore) : 1;
    }
    return n;
  }
}
