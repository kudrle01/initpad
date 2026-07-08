import { Injectable, Logger } from '@nestjs/common';
import type { Client } from 'ssh2';
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
  portSlot,
  sshConnect,
  sshEnd,
  sshExec,
  uploadTar,
  type ExecResult,
} from './ssh-utils';

const DEFAULT_START = 'node src/index.js';

// Effective connection for one call: the user's custom target (prod) or the
// platform's demo VPS (fake-vps).
interface EffConn {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  remoteRoot: string;
  custom: boolean;
  publicUrl?: string;
}

/**
 * Deploys a runtime (Node) application to a remote host over SSH.
 *
 * Two kinds of target:
 *  - demo (no connection): the fake-vps container; the app port is allocated
 *    from a pool and published 1:1 to the host for the health check;
 *  - custom (input.connection): the user's own VPS; the app runs there and is
 *    reached at the user-provided public URL (used for the health check).
 *
 * Flow: upload source (tar) → extract into releases/<version> → npm install →
 * switch the `current` symlink → (re)start the process → health check.
 */
@Injectable()
export class SshProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'ssh';
  private readonly logger = new Logger('SshProvider');
  private readonly cfg = config.providers.ssh;
  private readonly PATH = 'PATH=/usr/local/bin:/usr/bin:/bin:$PATH';

  private eff(input: { connection?: ProviderConnection }): EffConn {
    if (input.connection) {
      const c = input.connection;
      return {
        host: c.host,
        port: c.port,
        username: c.username,
        password: c.password,
        privateKey: c.privateKey,
        remoteRoot: c.remoteRoot.replace(/\/+$/, ''),
        custom: true,
        publicUrl: c.publicUrl.replace(/\/+$/, ''),
      };
    }
    return {
      host: this.cfg.host,
      port: this.cfg.port,
      username: this.cfg.username,
      password: this.cfg.password,
      remoteRoot: this.cfg.remoteRoot,
      custom: false,
    };
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const cfg = this.eff(input);
    const appPort = cfg.custom ? (input.port ?? 8080) : this.resolvePort(input);
    const base = `${cfg.remoteRoot}/${input.projectName}-${input.env}`;
    const version = this.sanitize(input.version) || 'latest';
    const release = `${base}/releases/${version}`;
    const url = cfg.custom ? cfg.publicUrl! : `http://${config.publicHost}:${appPort}`;
    const healthPath = input.healthPath ?? '/health';

    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch (e) {
      const reason = `Cannot reach SSH host ${cfg.host}:${cfg.port} (${(e as Error).message})`;
      this.logger.warn(reason);
      return { status: 'failed', url: '', reason };
    }

    try {
      const node = await sshExec(conn, `${this.PATH} command -v node`);
      if (node.code !== 0) {
        return {
          status: 'failed',
          url: '',
          reason: 'No Node.js runtime on the SSH host.',
        };
      }

      await this.execOrFail(conn, `mkdir -p ${release}`, 'prepare release dir');

      const sftp = await getSftp(conn);
      await uploadTar(sftp, input.repoPath, `${base}/app.tar`);
      await this.execOrFail(
        conn,
        `tar xf ${base}/app.tar -C ${release} && rm -f ${base}/app.tar`,
        'extract source',
      );
      await this.execOrFail(
        conn,
        `cd ${release} && ${this.PATH} npm install --omit=dev --no-audit --no-fund`,
        'npm install',
      );
      await sshExec(
        conn,
        `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; ln -sfn ${release} ${base}/current; true`,
      );

      const startCmd = input.startCommand ?? DEFAULT_START;
      await this.execOrFail(
        conn,
        `cd ${base}/current && ( ${this.PATH} PORT=${appPort} nohup ${startCmd} > ${base}/app.log 2>&1 & echo $! > ${base}/app.pid )`,
        'start app',
      );

      const healthy = cfg.custom
        ? await this.waitHealthyUrl(`${url}${healthPath.startsWith('/') ? '' : '/'}${healthPath}`)
        : await this.waitHealthy(appPort, healthPath);
      if (!healthy) {
        const log = await sshExec(conn, `tail -n 20 ${base}/app.log`).catch(() => null);
        return {
          status: 'failed',
          url,
          reason:
            `App did not pass health check at ${url}${healthPath} within ~15s.` +
            (log?.stdout ? `\n--- last log ---\n${log.stdout.trim()}` : ''),
        };
      }

      this.logger.log(`Deployed over SSH: ${input.projectName} (${input.env}) → ${url}`);
      return { status: 'running', url };
    } catch (e) {
      return { status: 'failed', url: '', reason: (e as Error).message };
    } finally {
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<void> {
    const cfg = this.eff(input);
    const base = `${cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch {
      return;
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

  async stop(input: TeardownInput): Promise<void> {
    const cfg = this.eff(input);
    const base = `${cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
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

  async start(input: StartInput): Promise<DeployResult> {
    const cfg = this.eff(input);
    const appPort = cfg.custom ? (input.port ?? 8080) : this.resolvePort(input);
    const base = `${cfg.remoteRoot}/${input.projectName}-${input.env}`;
    const url = cfg.custom ? cfg.publicUrl! : `http://${config.publicHost}:${appPort}`;
    const healthPath = input.healthPath ?? '/health';

    let conn: Client;
    try {
      conn = await sshConnect(cfg);
    } catch (e) {
      return { status: 'failed', url: '', reason: `Cannot reach SSH host ${cfg.host}:${cfg.port} (${(e as Error).message})` };
    }
    try {
      const has = await sshExec(conn, `[ -d ${base}/current ] && echo ok`);
      if (!has.stdout.includes('ok')) {
        return { status: 'failed', url: '', reason: 'No release to start — use Redeploy first.' };
      }
      await sshExec(conn, `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; true`);
      const startCmd = input.startCommand ?? DEFAULT_START;
      await this.execOrFail(
        conn,
        `cd ${base}/current && ( ${this.PATH} PORT=${appPort} nohup ${startCmd} > ${base}/app.log 2>&1 & echo $! > ${base}/app.pid )`,
        'start app',
      );
      const healthy = cfg.custom
        ? await this.waitHealthyUrl(`${url}${healthPath.startsWith('/') ? '' : '/'}${healthPath}`)
        : await this.waitHealthy(appPort, healthPath);
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
    const cfg = this.eff(input);
    const base = `${cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(cfg);
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

  private resolvePort(input: { projectName: string; env: string; appPort?: number }): number {
    if (input.appPort) return input.appPort;
    const slot = portSlot(`${input.projectName}-${input.env}`, this.cfg.appPortSlots);
    return this.cfg.appPortBase + slot;
  }

  private async execOrFail(conn: Client, cmd: string, label: string): Promise<ExecResult> {
    const res = await sshExec(conn, cmd);
    if (res.code !== 0) {
      const detail = (res.stderr || res.stdout).trim().split('\n').slice(-5).join('\n');
      throw new Error(`SSH step "${label}" failed (exit ${res.code}): ${detail}`);
    }
    return res;
  }

  // Demo target: the app port is published 1:1 to the host, health-check localhost.
  private async waitHealthy(port: number, path: string): Promise<boolean> {
    const target = `http://${config.deployHealthHost}:${port}${path.startsWith('/') ? '' : '/'}${path}`;
    return this.pollOk(target);
  }

  // Custom target: health-check the user-provided public URL.
  private async waitHealthyUrl(url: string): Promise<boolean> {
    return this.pollOk(url);
  }

  private async pollOk(target: string): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(target);
        if (res.ok) return true;
      } catch {
        // still starting — retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private sanitize(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }
}
