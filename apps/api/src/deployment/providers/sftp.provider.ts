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

// Nasazení statické / PHP aplikace přes SFTP – reálný upload do kontejneru
// fake-sftp (atmoz/sftp, jen SFTP subsystém, bez shellu). Obsah servíruje nginx
// přes symlink `current`. Vzor „releases + current": nahraj do releases/<version>,
// pak přehoď symlink → atomické přepnutí verze bez výpadku rozpracovaného uploadu.
@Injectable()
export class SftpProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'sftp';
  private readonly logger = new Logger('SftpProvider');
  private readonly cfg = config.providers.sftp;

  async deploy(input: DeployInput): Promise<DeployResult> {
    const root = this.cfg.remoteRoot; // např. /www (chroot SFTP uživatele)
    const version = this.safe(input.version) || 'latest';
    const release = `${root}/releases/${version}`;
    // Zdroj: buď podadresář se statickým buildem, nebo celý repo.
    const localDir = this.cfg.artifactSubdir
      ? join(input.repoPath, this.cfg.artifactSubdir)
      : input.repoPath;

    if (!existsSync(localDir)) {
      return {
        status: 'failed',
        url: '',
        reason: `Artifact directory '${localDir}' does not exist.`,
      };
    }

    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      const reason = `Cannot reach SFTP host ${this.cfg.host}:${this.cfg.port} — is fake-sftp running? (${(e as Error).message})`;
      this.logger.warn(reason);
      return { status: 'failed', url: '', reason };
    }

    try {
      const sftp = await getSftp(conn);

      // Nahraj nový release (bez node_modules/.git).
      await mkdirp(sftp, release);
      await uploadDir(sftp, localDir, release);

      // Atomické přepnutí: symlink current → releases/<version> (relativní cíl,
      // ať sedí i uvnitř mountu nginxu). Starý symlink nejdřív odstraníme.
      await this.swapCurrent(sftp, root, `releases/${version}`);

      const url = this.cfg.publicUrl;
      const reachable = await this.ping(url);
      if (!reachable) {
        this.logger.warn(`SFTP upload OK, ale ${url} neodpovídá (běží nginx?).`);
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
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<void> {
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return;
    }
    try {
      const sftp = await getSftp(conn);
      await sftpUnlink(sftp, `${this.cfg.remoteRoot}/current`);
      await sftpRmrf(sftp, `${this.cfg.remoteRoot}/releases`);
      this.logger.log(`Torn down SFTP deploy: ${input.projectName} (${input.env})`);
    } finally {
      sshEnd(conn);
    }
  }

  async logs(): Promise<string> {
    // Statické hostování nemá běhové logy procesu (na rozdíl od Dockeru/SSH).
    return 'Static hosting has no process logs. Files are served by nginx from the `current` release.';
  }

  // „Stop" statiky = odpojit symlink `current` → web přestane servírovat (soubory
  // release zůstanou). „Start" ho zase napojí na nejnovější release.
  async stop(): Promise<void> {
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return;
    }
    try {
      const sftp = await getSftp(conn);
      await sftpUnlink(sftp, `${this.cfg.remoteRoot}/current`);
      this.logger.log('SFTP site unpublished (current symlink removed).');
    } finally {
      sshEnd(conn);
    }
  }

  async start(): Promise<DeployResult> {
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      return { status: 'failed', url: '', reason: `Cannot reach SFTP host (${(e as Error).message})` };
    }
    try {
      const sftp = await getSftp(conn);
      const entries = await sftpReaddir(sftp, `${this.cfg.remoteRoot}/releases`);
      const dirs = entries.filter((e) => e.isDir).map((e) => e.name).sort();
      if (dirs.length === 0) {
        return { status: 'failed', url: '', reason: 'No release to start — use Redeploy first.' };
      }
      await this.swapCurrent(sftp, this.cfg.remoteRoot, `releases/${dirs[dirs.length - 1]}`);
      const url = this.cfg.publicUrl;
      const reachable = await this.ping(url);
      return reachable
        ? { status: 'running', url }
        : { status: 'failed', url, reason: `${url} is not serving — is nginx running?` };
    } finally {
      sshEnd(conn);
    }
  }

  // Přehodí symlink `current` na nový cíl (relativní k rootu).
  private async swapCurrent(sftp: SFTPWrapper, root: string, target: string): Promise<void> {
    const link = `${root}/current`;
    await sftpUnlink(sftp, link); // best-effort, když ještě neexistuje
    await sftpSymlink(sftp, target, link);
  }

  private async ping(url: string): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(url);
        if (res.status < 500) return true;
      } catch {
        // nginx ještě nenaběhl / nedostupný
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private safe(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }
}
