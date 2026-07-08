import { Injectable, Logger } from '@nestjs/common';
import type { Client, SFTPWrapper } from 'ssh2';
import { exec } from 'child_process';
import { existsSync } from 'fs';
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
} from '../deployment-provider.interface';
import {
  getSftp,
  mkdirp,
  sftpReaddir,
  sftpRmrf,
  sftpSymlink,
  sftpUnlink,
  sshConnect,
  sshEnd,
  uploadDir,
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
      };
    }
    return { ...config.providers.sftp };
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
      await mkdirp(sftp, release);
      await uploadDir(sftp, localDir, release);
      await this.swapLink(sftp, cfg.remoteRoot, slug, `${slug}-releases/${version}`);

      const url = this.publicUrl(cfg, slug);
      const reachable = await this.waitReachable(this.internalUrl(cfg, slug));
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
      await sftpUnlink(sftp, `${cfg.remoteRoot}/${slug}`);
      await sftpRmrf(sftp, `${cfg.remoteRoot}/${slug}-releases`);
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

  private publicUrl(cfg: EffCfg, slug: string): string {
    return `${cfg.publicUrl.replace(/\/+$/, '')}/${slug}/`;
  }

  private internalUrl(cfg: EffCfg, slug: string): string {
    return `${cfg.internalUrl.replace(/\/+$/, '')}/${slug}/`;
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

  private sanitize(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }
}
