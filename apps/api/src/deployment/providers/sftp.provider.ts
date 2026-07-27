import { Injectable, Logger } from '@nestjs/common';
import type { Client, SFTPWrapper } from 'ssh2';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ProviderKind } from '../../domain/types';
import { config } from '../../config';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
  ProviderConnection,
  StartInput,
  TeardownInput,
  TeardownResult,
  VerifyResult,
} from '../deployment-provider.interface';
import {
  assertSftpWritable,
  getSftp,
  mkdirp,
  sftpChmodTree,
  sftpReaddir,
  sftpRename,
  sftpRmrf,
  sftpSymlink,
  sftpUnlink,
  shellQuote,
  sshConnect,
  sshEnd,
  sshExec,
  uploadDir,
  uploadTar,
} from './ssh-utils';
import { PRIVATE_HTACCESS, PRIVATE_PROBE } from './sftp-layout';

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

  private eff(input: {
    connection?: ProviderConnection;
    allocation?: { rootPath: string | null; publicUrl: string | null };
  }): EffCfg {
    if (input.connection) {
      const c = input.connection;
      const base = (input.allocation?.publicUrl ?? c.publicUrl).replace(/\/+$/, '');
      return {
        host: c.host,
        port: c.port,
        username: c.username,
        password: c.password,
        privateKey: c.privateKey,
        remoteRoot: (input.allocation?.rootPath ?? c.remoteRoot).replace(/\/+$/, ''),
        publicUrl: base,
        internalUrl: base, // the user's server is reachable directly
        artifactSubdir: '',
        custom: true,
      };
    }
    const base = config.providers.sftp;
    const remoteRoot = (input.allocation?.rootPath ?? base.remoteRoot).replace(/\/+$/, '');
    const baseRoot = base.remoteRoot.replace(/\/+$/, '') || '/';
    const rootPrefix = baseRoot === '/' ? '/' : `${baseRoot}/`;
    const relativeRoot = remoteRoot.startsWith(rootPrefix)
      ? remoteRoot.slice(rootPrefix.length)
      : '';
    return {
      ...base,
      remoteRoot,
      publicUrl: (input.allocation?.publicUrl ?? base.publicUrl).replace(/\/+$/, ''),
      internalUrl: relativeRoot
        ? `${base.internalUrl.replace(/\/+$/, '')}/${relativeRoot}`
        : base.internalUrl,
      custom: false,
    };
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
      await assertSftpWritable(sftp, cfg.remoteRoot);
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
      const url = this.publicUrl(cfg, slug, input.webRoot, input.protectedWebLayout);
      const internalUrl = this.internalUrl(
        cfg,
        slug,
        input.webRoot,
        input.protectedWebLayout,
      );
      const reachable = await this.waitReachable(internalUrl);
      if (!reachable) {
        return {
          status: 'failed',
          url,
          reason: `Files uploaded, but ${url} is not serving them (is the web server up / the public URL correct?).`,
        };
      }
      if (input.protectedWebLayout) {
        const base = cfg.internalUrl.replace(/\/+$/, '');
        const checks = [
          `${internalUrl.replace(/\/+$/, '')}/.initpad-app/${PRIVATE_PROBE}`,
          `${internalUrl.replace(/\/+$/, '')}/.initpad-app/composer.json`,
          ...(input.writableDirs?.length
            ? [`${base}/.initpad-data/${slug}/.initpad-probe`]
            : []),
        ];
        const protectedResults = await Promise.all(
          checks.map((privateUrl) => this.privateFilesProtected(privateUrl)),
        );
        if (protectedResults.some((protectedFile) => !protectedFile)) {
          if (cfg.custom) {
            await this.removeCustom(conn, sftp, cfg, slug);
          } else {
            await sftpUnlink(sftp, `${cfg.remoteRoot}/${slug}`);
            await sftpRmrf(sftp, `${cfg.remoteRoot}/${slug}-releases`);
          }
          return {
            status: 'failed',
            url: '',
            reason:
              'Deployment was rolled back because the server exposed private application files. Enable Apache .htaccess/AllowOverride for this target.',
          };
        }
        await sftpUnlink(sftp, `${cfg.remoteRoot}/${slug}/.initpad-app/${PRIVATE_PROBE}`);
        await sftpUnlink(sftp, `${cfg.remoteRoot}/.initpad-data/${slug}/.initpad-probe`);
      }
      this.logger.log(`Deployed over SFTP: ${input.projectName} (${input.env}) → ${url}`);
      return { status: 'running', url };
    } catch (e) {
      return { status: 'failed', url: '', reason: (e as Error).message };
    } finally {
      sshEnd(conn);
    }
  }

  async teardown(input: TeardownInput): Promise<TeardownResult | void> {
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
      let result: TeardownResult | void = undefined;
      if (cfg.custom) {
        result = await this.removeCustom(conn, sftp, cfg, slug);
      } else {
        await sftpUnlink(sftp, `${cfg.remoteRoot}/${slug}`);
        await sftpRmrf(sftp, `${cfg.remoteRoot}/${slug}-releases`);
      }
      this.logger.log(`Torn down SFTP deploy: ${input.projectName} (${input.env})`);
      return result;
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

  // Protected shared-hosting layouts flatten www/public into <slug>/; legacy
  // layouts retain the explicit webRoot suffix.
  private servedSuffix(slug: string, webRoot?: string, protectedWebLayout = false): string {
    const wr = webRoot && !protectedWebLayout ? `${webRoot.replace(/^\/+|\/+$/g, '')}/` : '';
    return `${slug}/${wr}`;
  }

  private publicUrl(
    cfg: EffCfg,
    slug: string,
    webRoot?: string,
    protectedWebLayout = false,
  ): string {
    return `${cfg.publicUrl.replace(/\/+$/, '')}/${this.servedSuffix(slug, webRoot, protectedWebLayout)}`;
  }

  private internalUrl(
    cfg: EffCfg,
    slug: string,
    webRoot?: string,
    protectedWebLayout = false,
  ): string {
    return `${cfg.internalUrl.replace(/\/+$/, '')}/${this.servedSuffix(slug, webRoot, protectedWebLayout)}`;
  }

  private async privateFilesProtected(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      return !response.ok;
    } catch {
      // The public app was reachable immediately before this check, so a
      // network failure here means protection could not be proven.
      return false;
    }
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
      const qTar = shellQuote(tarPath);
      const qStaging = shellQuote(staging);
      const qDest = shellQuote(dest);
      input.onProgress?.('Uploading archive');
      await uploadTar(sftp, localDir, tarPath);
      input.onProgress?.('Extracting on the server');
      const prepared = await sshExec(conn, `rm -rf -- ${qStaging} && mkdir -p -- ${qStaging}`);
      if (prepared.code !== 0) {
        throw new Error(`Remote staging failed: ${(prepared.stderr || prepared.stdout).trim().slice(-300)}`);
      }
      const ex = await sshExec(conn, `tar xf ${qTar} -C ${qStaging}`);
      await sshExec(conn, `rm -f -- ${qTar}`);
      if (ex.code !== 0) {
        throw new Error(`Remote extract failed: ${(ex.stderr || ex.stdout).trim().slice(-300)}`);
      }
      // Web-readable: files get +r, directories +rx (traversable). Runtime dirs
      // (Nette temp/log …) world-writable.
      const readable = await sshExec(conn, `chmod -R a+rX ${qStaging}`);
      if (readable.code !== 0) {
        throw new Error(`Remote chmod failed: ${(readable.stderr || readable.stdout).trim().slice(-300)}`);
      }
      for (const d of writable) {
        const path = shellQuote(`${staging}/${d}`);
        await sshExec(conn, `chmod -R 0777 ${path} 2>/dev/null || true`);
        // PHP-FPM/Apache may create cache children as another Unix identity.
        // A default ACL makes the SFTP/deploy identity retain access to those
        // descendants, preventing undeletable releases. Hosts without POSIX
        // ACL support keep the compatibility chmod fallback above.
        if (!input.protectedWebLayout) {
          const acl = await sshExec(
            conn,
            `if command -v setfacl >/dev/null 2>&1; then find ${path} -type d -exec setfacl -m "u:$(id -u):rwx,d:u:$(id -u):rwx" {} +; fi`,
          );
          if (acl.code !== 0) {
            this.logger.warn(`Could not set persistent deploy ACL on ${staging}/${d}`);
          }
        }
      }
      if (input.protectedWebLayout && writable.length) {
        await this.attachStableWritableDirs(conn, cfg, slug, staging, writable);
      }
      input.onProgress?.('Publishing');
      const quarantineRoot = `${cfg.remoteRoot}/.initpad-quarantine`;
      const quarantine = `${quarantineRoot}/${slug}-${Date.now().toString(36)}`;
      const swap = await sshExec(
        conn,
        `if rm -rf -- ${qDest}; then :; else mkdir -p -- ${shellQuote(quarantineRoot)} && chmod 0700 ${shellQuote(quarantineRoot)} && mv -- ${qDest} ${shellQuote(quarantine)} && echo INITPAD_QUARANTINED; fi && mv -- ${qStaging} ${qDest}`,
      );
      if (swap.code !== 0) {
        throw new Error(`Remote publish failed: ${(swap.stderr || swap.stdout).trim().slice(-300)}`);
      }
      if (swap.stdout.includes('INITPAD_QUARANTINED')) {
        this.logger.warn(
          `Legacy runtime-owned release moved to protected quarantine: ${quarantine}. Ask the target administrator to remove it.`,
        );
      }
      return;
    }

    if (input.protectedWebLayout && writable.length) {
      throw new Error(
        'This PHP deployment requires SSH shell access on the SFTP target so InitPad can isolate persistent runtime data safely.',
      );
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

  private async removeCustom(
    conn: Client,
    sftp: SFTPWrapper,
    cfg: EffCfg,
    slug: string,
  ): Promise<TeardownResult | void> {
    // Real host: the served folder is a real directory (no releases/symlink).
    if (!(await this.execWorks(conn))) {
      await sftpRmrf(sftp, `${cfg.remoteRoot}/${slug}`);
      return;
    }
    const quarantineRoot = `${cfg.remoteRoot}/.initpad-quarantine`;
    const quarantineStamp = Date.now().toString(36);
    const publicPaths = [
      {
        path: `${cfg.remoteRoot}/${slug}`,
        quarantine: `${quarantineRoot}/${slug}-legacy-${quarantineStamp}`,
      },
      {
        path: `${cfg.remoteRoot}/${slug}__deploying`,
        quarantine: `${quarantineRoot}/${slug}-staging-${quarantineStamp}`,
      },
      {
        path: `${cfg.remoteRoot}/${slug}.deploy.tar`,
        quarantine: `${quarantineRoot}/${slug}-archive-${quarantineStamp}`,
      },
    ];
    // Legacy PHP releases kept writable runtime data directly below the
    // public project path. `rm -rf` can therefore remove most of the site and
    // still fail on a foreign-owned cache descendant. Move any such remainder
    // out of the canonical path so a future project may safely reuse the same
    // name. A failed move remains a hard error: in that case name reuse is not
    // proven safe and the control-plane record must stay retryable.
    const publicRemoved = await sshExec(
      conn,
      publicPaths
        .map(
          ({ path, quarantine }) =>
            `if rm -rf -- ${shellQuote(path)}; then :; else ` +
            `mkdir -p -- ${shellQuote(quarantineRoot)} && chmod 0700 ${shellQuote(quarantineRoot)} && ` +
            `mv -- ${shellQuote(path)} ${shellQuote(quarantine)} && ` +
            `echo ${shellQuote(`INITPAD_QUARANTINED:${quarantine}`)}; fi`,
        )
        .join(' && '),
    );
    if (publicRemoved.code !== 0) {
      throw new Error(
        `Remote public teardown failed and the deployment name could not be released: ${(publicRemoved.stderr || publicRemoved.stdout).trim().slice(-300)}`,
      );
    }
    if (publicRemoved.stdout.includes('INITPAD_QUARANTINED:')) {
      this.logger.warn(
        `Legacy runtime-owned public data for ${slug} was moved to protected quarantine. ` +
          'The canonical deployment path is free; target-admin cleanup is still required.',
      );
    }

    const dataPath = `${cfg.remoteRoot}/.initpad-data/${slug}`;
    const dataRemoved = await sshExec(conn, `rm -rf -- ${shellQuote(dataPath)}`);
    if (dataRemoved.code !== 0) {
      const quarantine = `${quarantineRoot}/${slug}-runtime-${Date.now().toString(36)}`;
      const quarantined = await sshExec(
        conn,
        `mkdir -p -- ${shellQuote(quarantineRoot)} && chmod 0700 ${shellQuote(quarantineRoot)} && mv -- ${shellQuote(dataPath)} ${shellQuote(quarantine)}`,
      );
      if (quarantined.code !== 0) {
        throw new Error(
          `Public deployment was removed, but protected runtime data cleanup failed: ${(quarantined.stderr || quarantined.stdout).trim().slice(-300)}`,
        );
      }
      this.logger.warn(
        `Runtime-owned data moved to protected quarantine: ${quarantine}. Ask the target administrator to remove it.`,
      );
    }

    const pending = await sshExec(
      conn,
      `if [ -d ${shellQuote(quarantineRoot)} ]; then find ${shellQuote(quarantineRoot)} -mindepth 1 -maxdepth 1 -type d -name ${shellQuote(`${slug}-*`)} -print; fi`,
    );
    if (pending.code !== 0) {
      this.logger.warn(`Could not inspect protected quarantine for ${slug}`);
      return {
        warning: `Public deployment removed, but protected quarantine state could not be verified at ${quarantineRoot}.`,
      };
    }
    const paths = pending.stdout
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean);
    if (paths.length) {
      return {
        warning: `Public deployment removed. Its canonical path is free for reuse. Target administrator cleanup is still required for archived runtime data: ${paths.join(', ')}`,
      };
    }
  }

  private async attachStableWritableDirs(
    conn: Client,
    cfg: EffCfg,
    slug: string,
    staging: string,
    writable: string[],
  ): Promise<void> {
    const dataRoot = `${cfg.remoteRoot}/.initpad-data`;
    const projectData = `${dataRoot}/${slug}`;
    const probe = `${projectData}/.initpad-probe`;
    const prepared = await sshExec(
      conn,
      `mkdir -p -- ${shellQuote(projectData)} && chmod 0711 ${shellQuote(dataRoot)} ${shellQuote(projectData)} && printf %s ${shellQuote(PRIVATE_HTACCESS)} > ${shellQuote(`${dataRoot}/.htaccess`)} && printf %s initpad > ${shellQuote(probe)}`,
    );
    if (prepared.code !== 0) {
      throw new Error(
        `Could not prepare protected runtime storage: ${(prepared.stderr || prepared.stdout).trim().slice(-300)}`,
      );
    }
    for (const directory of writable) {
      if (
        !/^[A-Za-z0-9._/-]+$/.test(directory) ||
        directory.split('/').some((part) => part === '..')
      ) {
        throw new Error(`Invalid writable directory '${directory}'`);
      }
      const logical = directory.replace(/^\.initpad-app\//, '');
      const stable = `${projectData}/${logical}`;
      const staged = `${staging}/${directory}`;
      const linked = await sshExec(
        conn,
        `mkdir -p -- ${shellQuote(stable)} && (chmod -R 0777 ${shellQuote(stable)} 2>/dev/null || true) && rm -rf -- ${shellQuote(staged)} && ln -s -- ${shellQuote(stable)} ${shellQuote(staged)}`,
      );
      if (linked.code !== 0) {
        throw new Error(
          `Could not attach runtime storage '${logical}': ${(linked.stderr || linked.stdout).trim().slice(-300)}`,
        );
      }
      const acl = await sshExec(
        conn,
        `if command -v setfacl >/dev/null 2>&1; then find ${shellQuote(stable)} -type d -exec setfacl -m "u:$(id -u):rwx,d:u:$(id -u):rwx" {} +; fi`,
      );
      if (acl.code !== 0) {
        this.logger.warn(`Could not set persistent deploy ACL on ${stable}`);
      }
    }
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
