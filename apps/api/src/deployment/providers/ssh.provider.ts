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

// Nasazení runtime aplikace (Node) na vzdálený host přes SSH – reálné spojení
// proti kontejneru fake-vps (sshd + Node), který simuluje firemní VPS.
// Postup: nahraj zdroj (tar) → rozbal do releases/<version> → npm install →
// přepni symlink `current` → (re)start procesu → health check přes publikovaný port.
@Injectable()
export class SshProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'ssh';
  private readonly logger = new Logger('SshProvider');
  private readonly cfg = config.providers.ssh;
  // Node/npm nemusí být na neinteraktivním PATH – nastavíme ho explicitně.
  private readonly PATH = 'PATH=/usr/local/bin:/usr/bin:/bin:$PATH';

  async deploy(input: DeployInput): Promise<DeployResult> {
    const slot = portSlot(`${input.projectName}-${input.env}`, this.cfg.appPortSlots);
    const appPort = this.cfg.appPortBase + slot;
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    const version = this.safe(input.version) || 'latest';
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

    try {
      // Node na hostu? Bez runtime nemá smysl pokračovat.
      const node = await sshExec(conn, `${this.PATH} command -v node`);
      if (node.code !== 0) {
        return {
          status: 'failed',
          url: '',
          reason: 'No Node.js runtime on the SSH host (fake-vps image must ship node).',
        };
      }

      await this.check(conn, `mkdir -p ${release}`, 'prepare release dir');

      // Nahraj zdroj jako tar a rozbal (bez node_modules/.git).
      const sftp = await getSftp(conn);
      await uploadTar(sftp, input.repoPath, `${base}/app.tar`);
      await this.check(
        conn,
        `tar xf ${base}/app.tar -C ${release} && rm -f ${base}/app.tar`,
        'extract source',
      );

      // Instalace závislostí (bez lockfile → install, ne ci).
      await this.check(
        conn,
        `cd ${release} && ${this.PATH} npm install --omit=dev --no-audit --no-fund`,
        'npm install',
      );

      // Zastav předchozí instanci (pokud běží) a přepni symlink current → release.
      await sshExec(
        conn,
        `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; ln -sfn ${release} ${base}/current; true`,
      );

      // Start na pevném portu (publikovaný 1:1 na host). Subshell + nohup: proces
      // přežije zavření SSH kanálu a do pidfile jde PID samotného node.
      await this.check(
        conn,
        `cd ${base}/current && ( ${this.PATH} PORT=${appPort} nohup node src/index.js > ${base}/app.log 2>&1 & echo $! > ${base}/app.pid )`,
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
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<void> {
    const base = `${this.cfg.remoteRoot}/${input.projectName}-${input.env}`;
    let conn: Client;
    try {
      conn = await sshConnect(this.cfg);
    } catch {
      return; // host nedostupný – nic k úklidu
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

  // Zastaví běžící proces (release na disku zůstává, jde znovu Start).
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

  // Znovu spustí naposledy nasazený release (symlink current) na stejném portu.
  async start(input: StartInput): Promise<DeployResult> {
    const slot = portSlot(`${input.projectName}-${input.env}`, this.cfg.appPortSlots);
    const appPort = this.cfg.appPortBase + slot;
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
      // Pro jistotu zabij případný běžící proces a spusť znovu.
      await sshExec(conn, `[ -f ${base}/app.pid ] && kill "$(cat ${base}/app.pid)" 2>/dev/null; true`);
      await this.check(
        conn,
        `cd ${base}/current && ( ${this.PATH} PORT=${appPort} nohup node src/index.js > ${base}/app.log 2>&1 & echo $! > ${base}/app.pid )`,
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

  // Spustí příkaz a vyhodí chybu s kontextem, když skončí nenulově.
  private async check(conn: Client, cmd: string, label: string): Promise<ExecResult> {
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
        // ještě nestartuje
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  // Jen bezpečné znaky pro cestu release adresáře.
  private safe(v: string): string {
    return v.replace(/[^a-zA-Z0-9._-]/g, '');
  }
}
