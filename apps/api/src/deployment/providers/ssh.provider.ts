import { Injectable, Logger } from '@nestjs/common';
import type { Client } from 'ssh2';
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
  portSlot,
  sshConnect,
  sshEnd,
  sshExec,
  uploadTar,
  type ExecResult,
} from './ssh-utils';
import { exportVersion } from './source-export';

// Fallback for templates that predate the startCommand manifest field.
const DEFAULT_START = 'node src/index.js';

/**
 * Deploys a runtime (Node) application to a remote host over SSH — a real
 * protocol conversation with the fake-vps container (sshd + Node) that stands
 * in for a company VPS.
 *
 * Flow: upload source (tar) → extract into releases/<version> → npm install →
 * switch the `current` symlink → (re)start the process → health check via the
 * published port.
 */
@Injectable()
export class SshProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'ssh';
  private readonly logger = new Logger('SshProvider');
  private readonly cfg = config.providers.ssh;
  // node/npm may be missing from the non-interactive PATH — set it explicitly.
  private readonly PATH = 'PATH=/usr/local/bin:/usr/bin:/bin:$PATH';

  async deploy(input: DeployInput): Promise<DeployResult> {
    const appPort = this.resolvePort(input);
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    const version = this.sanitize(input.version) || 'latest';
    const release = `${base}/releases/${version}`;
    const url = `http://localhost:${appPort}`;

    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      const reason = `Cannot reach SSH host ${this.cfg.host}:${this.cfg.port} — is fake-vps running? (${(e as Error).message})`;
      this.logger.warn(reason);
      return { status: 'failed', url: '', reason };
    }

    // Deploy exactly the version being promoted — not the working tree,
    // which is synced to the latest main and may be newer.
    const exported = await exportVersion(input.repoPath, input.version);
    const sourceDir = exported?.dir ?? input.repoPath;

    try {
      // Without a Node runtime on the host there is nothing to run.
      const node = await sshExec(conn, `${this.PATH} command -v node`);
      if (node.code !== 0) {
        return {
          status: 'failed',
          url: '',
          reason: 'No Node.js runtime on the SSH host (fake-vps image must ship node).',
        };
      }

      await this.execOrFail(conn, `mkdir -p ${release}`, 'prepare release dir');

      // Upload the source as a tarball and extract it (node_modules/.git excluded).
      const sftp = await getSftp(conn);
      await uploadTar(sftp, sourceDir, `${base}/app.tar`);
      await this.execOrFail(
        conn,
        `tar xf ${base}/app.tar -C ${release} && rm -f ${base}/app.tar`,
        'extract source',
      );

      // Install dependencies (no lockfile in scaffolds → install, not ci).
      await this.execOrFail(
        conn,
        `cd ${release} && ${this.PATH} npm install --omit=dev --no-audit --no-fund`,
        'npm install',
      );

      // Stop the previous instance (if any) and atomically switch the
      // `current` symlink to the new release.
      await sshExec(
        conn,
        `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; ln -sfn ${release} ${base}/current; true`,
      );

      // Start on a fixed port (published 1:1 to the host). Subshell + nohup:
      // the process survives the SSH channel closing, and the pidfile records
      // the PID of the app process itself. The start command is a property of
      // the template (manifest.startCommand), not of this provider.
      const startCmd = input.startCommand ?? DEFAULT_START;
      await this.execOrFail(
        conn,
        `cd ${base}/current && ( ${this.PATH} PORT=${appPort} nohup ${startCmd} > ${base}/app.log 2>&1 & echo $! > ${base}/app.pid )`,
        'start app',
      );

      const healthy = await this.waitHealthy(appPort, input.healthPath ?? '/health');
      if (!healthy) {
        const log = await sshExec(conn, `tail -n 20 ${base}/app.log`).catch(() => null);
        this.logger.warn(`${input.projectName} (${input.env}) SSH deploy unhealthy`);
        return {
          status: 'failed',
          url,
          reason:
            `App did not pass health check at ${url}${input.healthPath ?? '/health'} within ~15s.` +
            (log?.stdout ? `\n--- last log ---\n${log.stdout.trim()}` : ''),
        };
      }

      this.logger.log(`Deployed over SSH: ${input.projectName} (${input.env}) → ${url}`);
      return { status: 'running', url };
    } catch (e) {
      return { status: 'failed', url: '', reason: (e as Error).message };
    } finally {
      exported?.cleanup();
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<void> {
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return; // Host unreachable — nothing to clean up.
    }
    try {
      await sshExec(
        conn,
        `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; rm -rf ${base}; true`,
      );
      this.logger.log(`Torn down SSH deploy: ${input.projectName} (${input.env})`);
    } finally {
      sshEnd(conn);
    }
  }

  // Stops the running process; the release stays on disk so Start can resume it.
  async stop(input: TeardownInput): Promise<void> {
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return;
    }
    try {
      await sshExec(
        conn,
        `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; rm -f ${base}/app.pid; true`,
      );
      this.logger.log(`Stopped SSH app: ${input.projectName} (${input.env})`);
    } finally {
      sshEnd(conn);
    }
  }

  // Re-starts the most recently deployed release (the `current` symlink) on
  // the same port.
  async start(input: StartInput): Promise<DeployResult> {
    const appPort = this.resolvePort(input);
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    const url = `http://localhost:${appPort}`;

    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      return {
        status: 'failed',
        url: '',
        reason: `Cannot reach SSH host ${this.cfg.host}:${this.cfg.port} (${(e as Error).message})`,
      };
    }
    try {
      const has = await sshExec(conn, `[ -d ${base}/current ] && echo ok`);
      if (!has.stdout.includes('ok')) {
        return { status: 'failed', url: '', reason: 'No release to start — use Redeploy first.' };
      }
      // Defensively kill any leftover process, then start fresh.
      await sshExec(conn, `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; true`);
      const startCmd = input.startCommand ?? DEFAULT_START;
      await this.execOrFail(
        conn,
        `cd ${base}/current && ( ${this.PATH} PORT=${appPort} nohup ${startCmd} > ${base}/app.log 2>&1 & echo $! > ${base}/app.pid )`,
        'start app',
      );
      const healthy = await this.waitHealthy(appPort, input.healthPath ?? '/health');
      if (!healthy) {
        return { status: 'failed', url, reason: `Health check at ${url} did not pass after start.` };
      }
      this.logger.log(`Started SSH app: ${input.projectName} (${input.env}) → ${url}`);
      return { status: 'running', url };
    } catch (e) {
      return { status: 'failed', url: '', reason: (e as Error).message };
    } finally {
      sshEnd(conn);
    }
  }

  async logs(input: TeardownInput): Promise<string> {
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch (e) {
      return `Logs unavailable: cannot reach SSH host (${(e as Error).message})`;
    }
    try {
      const res = await sshExec(conn, `tail -n 200 ${base}/app.log 2>/dev/null`);
      return res.stdout.trim() || 'No log output yet — the app may still be starting.';
    } finally {
      sshEnd(conn);
    }
  }

  // The application port is allocated by the platform from the database
  // (unique across all environments). The hash-slot fallback only covers
  // callers that do not supply a port (e.g. provider used standalone).
  private resolvePort(input: { projectName: string; env: string; appPort?: number }): number {
    if (input.appPort) return input.appPort;
    const slot = portSlot(`${input.projectName}-${input.env}`, this.cfg.appPortSlots);
    return this.cfg.appPortBase + slot;
  }

  // Runs a command and throws a labelled error when it exits non-zero.
  private async execOrFail(conn: Client, cmd: string, label: string): Promise<ExecResult> {
    const res = await sshExec(conn, cmd);
    if (res.code !== 0) {
      const detail = (res.stderr || res.stdout).trim().split('\n').slice(-5).join('\n');
      throw new Error(`SSH step "${label}" failed (exit ${res.code}): ${detail}`);
    }
    return res;
  }

  private async waitHealthy(port: number, path: string): Promise<boolean> {
    const target = `http://localhost:${port}${path.startsWith('/') ? '' : '/'}${path}`;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(target);
        if (res.ok) return true;
      } catch {
        // App still starting — retry.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  // Restrict to filesystem-safe characters for the release directory name.
  private sanitize(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }
}
