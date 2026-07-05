import { Injectable, Logger } from '@nestjs/common';
import type { Client, SFTPWrapper } from 'ssh2';
import { existsSync } from 'fs';
import { join } from 'path';
import { ProviderKind } from '../../domain/types';
import { config } from '../../config';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
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
import { exportVersion } from './source-export';

/**
 * Deploys a static / PHP application over SFTP — a real upload to the
 * fake-sftp container (atmoz/sftp: SFTP subsystem only, no shell). The
 * uploaded content is served by nginx.
 *
 * The remote layout is namespaced per project+environment so deployments
 * never overwrite each other:
 *
 *   <root>/<slug>-releases/<version>/…   uploaded releases
 *   <root>/<slug>                        symlink → <slug>-releases/<version>
 *
 * The public URL is <publicUrl>/<slug>/. nginx serves the volume root, so
 * swapping the symlink atomically switches the published version — the
 * classic "releases + current" deployment pattern.
 */
@Injectable()
export class SftpProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'sftp';
  private readonly logger = new Logger('SftpProvider');
  private readonly cfg = config.providers.sftp;

  async deploy(input: DeployInput): Promise<DeployResult> {
    const slug = this.slug(input);
    const version = this.sanitize(input.version) || 'latest';
    const releasesDir = `${this.cfg.remoteRoot}/${slug}-releases`;
    const release = `${releasesDir}/${version}`;

    // Deploy exactly the version being promoted — not the working tree.
    const exported = await exportVersion(input.repoPath, input.version);
    const sourceRoot = exported?.dir ?? input.repoPath;
    // Source: the template's artifact subdirectory, or the repository root.
    const artifactDir = input.artifactDir ?? this.cfg.artifactSubdir;
    const localDir = artifactDir ? join(sourceRoot, artifactDir) : sourceRoot;

    if (!existsSync(localDir)) {
      exported?.cleanup();
      return {
        status: 'failed',
        url: '',
        reason: `Artifact directory '${artifactDir || '.'}' does not exist in the deployed version.`,
      };
    }

    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      exported?.cleanup();
      const reason = `Cannot reach SFTP host ${this.cfg.host}:${this.cfg.port} — is fake-sftp running? (${(e as Error).message})`;
      this.logger.warn(reason);
      return { status: 'failed', url: '', reason };
    }

    try {
      const sftp = await getSftp(conn);

      // Upload the new release (node_modules/.git excluded).
      await mkdirp(sftp, release);
      await uploadDir(sftp, localDir, release);

      // Atomic switch: symlink <slug> → <slug>-releases/<version>. The target
      // is relative so it also resolves inside the nginx volume mount. The old
      // link is removed first (SFTP cannot atomically replace a symlink).
      await this.swapLink(sftp, slug, `${slug}-releases/${version}`);

      const url = this.publicUrl(slug);
      const reachable = await this.waitReachable(url);
      if (!reachable) {
        this.logger.warn(`SFTP upload succeeded but ${url} is not responding (is nginx up?).`);
        return {
          status: 'failed',
          url,
          reason: `Files uploaded, but ${url} is not serving them — is the nginx service running?`,
        };
      }

      this.logger.log(`Deployed over SFTP: ${input.projectName} (${input.env}) → ${url}`);
      return { status: 'running', url };
    } catch (e) {
      return { status: 'failed', url: '', reason: (e as Error).message };
    } finally {
      exported?.cleanup();
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<void> {
    const slug = this.slug(input);
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return;
    }
    try {
      const sftp = await getSftp(conn);
      // Only this project's subtree — other deployments are untouched.
      await sftpUnlink(sftp, `${this.cfg.remoteRoot}/${slug}`);
      await sftpRmrf(sftp, `${this.cfg.remoteRoot}/${slug}-releases`);
      this.logger.log(`Torn down SFTP deploy: ${input.projectName} (${input.env})`);
    } finally {
      sshEnd(conn);
    }
  }

  async logs(): Promise<string> {
    // Static hosting has no process to produce runtime logs (unlike Docker/SSH).
    return 'Static hosting has no process logs. Files are served by nginx from the published release.';
  }

  // "Stop" for a static site = unlink the public symlink (the site stops being
  // served; release files stay). "Start" re-links it to the deployed version.
  async stop(input: TeardownInput): Promise<void> {
    const slug = this.slug(input);
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return;
    }
    try {
      const sftp = await getSftp(conn);
      await sftpUnlink(sftp, `${this.cfg.remoteRoot}/${slug}`);
      this.logger.log(`SFTP site unpublished: ${slug}`);
    } finally {
      sshEnd(conn);
    }
  }

  async start(input: StartInput): Promise<DeployResult> {
    const slug = this.slug(input);
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      return { status: 'failed', url: '', reason: `Cannot reach SFTP host (${(e as Error).message})` };
    }
    try {
      const sftp = await getSftp(conn);
      // Prefer the version the platform recorded as deployed; fall back to the
      // lexicographically last release (hashes → only a best-effort guess).
      let version = input.version ? this.sanitize(input.version) : '';
      if (!version) {
        const entries = await sftpReaddir(sftp, `${this.cfg.remoteRoot}/${slug}-releases`);
        const dirs = entries.filter((e) => e.isDir).map((e) => e.name).sort();
        version = dirs[dirs.length - 1] ?? '';
      }
      if (!version) {
        return { status: 'failed', url: '', reason: 'No release to start — use Redeploy first.' };
      }
      await this.swapLink(sftp, slug, `${slug}-releases/${version}`);
      const url = this.publicUrl(slug);
      const reachable = await this.waitReachable(url);
      return reachable
        ? { status: 'running', url }
        : { status: 'failed', url, reason: `${url} is not serving — is nginx running?` };
    } finally {
      sshEnd(conn);
    }
  }

  // Re-points the <root>/<name> symlink at a new target (relative to root).
  private async swapLink(sftp: SFTPWrapper, name: string, target: string): Promise<void> {
    const link = `${this.cfg.remoteRoot}/${name}`;
    await sftpUnlink(sftp, link); // best-effort; the link may not exist yet
    await sftpSymlink(sftp, target, link);
  }

  // Deployment key <owner>-<name>-<env> → separate sites even for the test
  // and prod environments of the same project.
  private slug(input: { projectName: string; env: string }): string {
    return this.sanitize(`${input.projectName}-${input.env}`).toLowerCase();
  }

  private publicUrl(slug: string): string {
    return `${this.cfg.publicUrl.replace(/\/+$/, '')}/${slug}/`;
  }

  private async waitReachable(url: string): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(url);
        // Require actually served content (2xx), not just a running nginx —
        // a 404 would mask a broken symlink or a wrong document root.
        if (res.ok) return true;
      } catch {
        // nginx not up yet / unreachable — retry.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private sanitize(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }
}
