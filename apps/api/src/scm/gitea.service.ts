import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';

const exec = promisify(execFile);

// Identita, pod kterou se provádí operace s repem (vlastník projektu).
export interface GiteaActor {
  username: string;
  token: string;
}

// Zakládá repa a pushuje scaffold pod identitou vlastníka. Účty zakládá
// admin tokenem (řízená registrace).
@Injectable()
export class GiteaService {
  private readonly logger = new Logger('GiteaService');

  async provision(
    name: string,
    dir: string,
    actor: GiteaActor,
  ): Promise<{ repoUrl: string }> {
    const { url, adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    await this.createRepo(name, actor);
    await this.pushScaffold(name, dir, actor);
    const repoUrl = `${url}/${actor.username}/${name}`;
    this.logger.log(`Repo vytvořeno a nahráno: ${repoUrl}`);
    return { repoUrl };
  }

  // Založí uživatelský účet v Gitee přes admin API (řízená registrace).
  // Vrací Gitea ID a login nově vytvořeného uživatele.
  async createUser(input: {
    username: string;
    email: string;
    password: string;
  }): Promise<{ id: number; login: string }> {
    const { url, adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    const res = await fetch(`${url}/api/v1/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        password: input.password,
        must_change_password: false,
      }),
    });
    if (res.status === 422) {
      throw new Error('A user with this username or e-mail already exists in Gitea');
    }
    if (!res.ok) {
      throw new Error(`Gitea user creation failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { id: number; login: string };
    return { id: data.id, login: data.login };
  }

  // Vytvoří osobní access token nového uživatele (basic auth jeho heslem).
  // Token si platforma uloží a jedná jím za uživatele (git operace).
  async createUserToken(username: string, password: string): Promise<string> {
    const { url } = config.gitea;
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const res = await fetch(`${url}/api/v1/users/${username}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({
        name: `initpad-platform-${Date.now()}`,
        scopes: [
          'write:repository',
          'read:repository',
          'write:user',
          'read:user',
          'write:organization',
          'read:organization',
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Gitea token creation failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { sha1: string };
    return data.sha1;
  }

  // Smaže všechny verze container package (image v Gitea registru) pro daný
  // projekt – aby po smazání projektu nezůstaly artefakty ve skladu.
  async deletePackages(owner: string, name: string): Promise<void> {
    const { url, adminToken } = config.gitea;
    if (!url || !adminToken) return;
    const pkgName = name.toLowerCase();
    try {
      const res = await fetch(
        `${url}/api/v1/packages/${owner}?type=container&q=${encodeURIComponent(pkgName)}&limit=100`,
        { headers: { Authorization: `token ${adminToken}` } },
      );
      if (!res.ok) return;
      const pkgs = (await res.json()) as Array<{ type: string; name: string; version: string }>;
      for (const p of pkgs) {
        if (p.type !== 'container' || p.name.toLowerCase() !== pkgName) continue;
        await fetch(
          `${url}/api/v1/packages/${owner}/container/${p.name}/${encodeURIComponent(p.version)}`,
          { method: 'DELETE', headers: { Authorization: `token ${adminToken}` } },
        ).catch(() => undefined);
      }
    } catch {
      // best-effort úklid
    }
  }

  // Smaže repo v Gitee (best-effort; admin má právo do všech rep).
  async deleteRepo(name: string, actor: GiteaActor): Promise<void> {
    const { url, adminToken } = config.gitea;
    if (!url || !adminToken) return;
    await fetch(`${url}/api/v1/repos/${actor.username}/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${adminToken}` },
    }).catch(() => undefined);
  }

  // Vrátí commity z repa vlastníka, nebo null když není dostupné.
  async listCommits(
    name: string,
    actor: GiteaActor,
    limit = 20,
  ): Promise<{ sha: string; message: string; author: string; date: string }[] | null> {
    const { url, adminToken } = config.gitea;
    // Čtení jde admin tokenem – admin vidí všechna repa, takže nezáleží na
    // stavu per-user tokenu (např. přepsaný OAuth token). Cesta = vlastník repa.
    const readToken = adminToken || actor.token;
    if (!url || !readToken) return null;
    try {
      const endpoint = `${url}/api/v1/repos/${actor.username}/${name}/commits?limit=${limit}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `token ${readToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`listCommits ${actor.username}/${name} → HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as Array<{
        sha: string;
        commit: { message: string; author: { name: string; date: string } };
      }>;
      return data.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
      }));
    } catch {
      return null;
    }
  }

  // Vrátí commit statusy (jeden na CI job) pro daný commit – z nich platforma
  // skládá stav pipeline. Nejnovější status na daný kontext je první.
  async listCommitStatuses(
    name: string,
    sha: string,
    actor: GiteaActor,
  ): Promise<{ context: string; status: string; targetUrl: string | null }[] | null> {
    const { url, adminToken } = config.gitea;
    const readToken = adminToken || actor.token;
    if (!url || !readToken) return null;
    try {
      const res = await fetch(
        `${url}/api/v1/repos/${actor.username}/${name}/commits/${sha}/statuses?sort=recentupdate&limit=50`,
        { headers: { Authorization: `token ${readToken}` } },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{
        context: string;
        status: string;
        target_url?: string;
      }>;
      return data.map((s) => ({
        context: s.context,
        status: s.status,
        targetUrl: this.browserUrl(s.target_url),
      }));
    } catch {
      return null;
    }
  }

  private async createRepo(name: string, actor: GiteaActor): Promise<void> {
    const { url, adminToken } = config.gitea;
    // Platforma zakládá repo JMÉNEM uživatele přes admin token + Sudo header –
    // repo tak patří uživateli, ale nepotřebujeme jeho (křehký) osobní token.
    const res = await fetch(`${url}/api/v1/user/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${adminToken}`,
        Sudo: actor.username,
      },
      body: JSON.stringify({ name, private: true, auto_init: false, default_branch: 'main' }),
    });
    // 409 = repo already exists, continue with push
    if (!res.ok && res.status !== 409) {
      throw new Error(`repository creation failed (HTTP ${res.status})`);
    }
    // Zapne Actions (CI) pro repo (admin může editovat jakékoli repo).
    await fetch(`${url}/api/v1/repos/${actor.username}/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ has_actions: true }),
    }).catch(() => undefined);

    // Actions secrets: token pro deploy webhook + přihlášení do registru
    // (build once, deploy many – CI image pushne, platforma stáhne).
    await this.setRepoSecret(actor.username, name, 'INITPAD_DEPLOY_TOKEN', config.ci.deployToken);
    await this.setRepoSecret(actor.username, name, 'INITPAD_REGISTRY_USER', config.registry.user);
    await this.setRepoSecret(
      actor.username,
      name,
      'INITPAD_REGISTRY_PASSWORD',
      config.registry.password,
    );
  }

  private async setRepoSecret(
    owner: string,
    repo: string,
    key: string,
    value: string,
  ): Promise<void> {
    const { url, adminToken } = config.gitea;
    await fetch(`${url}/api/v1/repos/${owner}/${repo}/actions/secrets/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ data: value }),
    }).catch(() => undefined);
  }

  // Stáhne poslední stav větve do lokální workspace složky (fetch + hard reset),
  // aby platforma nasadila reálně pushnutý kód, ne původní scaffold.
  async syncFromRemote(dir: string, branch = 'main'): Promise<void> {
    const git = (args: string[]) => exec('git', args, { cwd: dir });
    await git(['fetch', 'origin', branch]);
    await git(['reset', '--hard', `origin/${branch}`]);
  }

  // Gitea generuje target_url s interním hostem (http://gitea:3000), který
  // prohlížeč nezná. Přepíšeme origin na veřejnou adresu (INITPAD_GITEA_URL).
  private browserUrl(target?: string): string | null {
    if (!target) return null;
    const base = config.gitea.url?.replace(/\/$/, '');
    if (!base) return target;
    try {
      const u = new URL(target);
      return `${base}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return `${base}${target.startsWith('/') ? '' : '/'}${target}`;
    }
  }

  // Z vygenerované složky udělá lokální git repo s commitem autora (vlastníka).
  async initLocal(dir: string, author?: { name: string; email: string }): Promise<void> {
    const name = author?.name || config.git.authorName;
    const email = author?.email || config.git.authorEmail;
    const git = (args: string[]) => exec('git', args, { cwd: dir });
    try {
      await git(['init', '-b', 'main']);
      await git(['add', '-A']);
      await git([
        '-c', `user.name=${name}`,
        '-c', `user.email=${email}`,
        'commit', '-m', 'init: scaffold from template',
      ]);
    } catch (e) {
      this.logger.warn(`Lokální git init selhal: ${(e as Error).message}`);
    }
  }

  private async pushScaffold(name: string, dir: string, actor: GiteaActor): Promise<void> {
    const git = (args: string[]) => exec('git', args, { cwd: dir });
    await git(['remote', 'remove', 'origin']).catch(() => undefined);
    await git(['remote', 'add', 'origin', this.authedRemote(name, actor)]);
    await git(['push', '-u', 'origin', 'main']);
  }

  private authedRemote(name: string, actor: GiteaActor): string {
    const { url, user, adminToken } = config.gitea;
    const sep = url.indexOf('://');
    const scheme = url.slice(0, sep + 3);
    const host = url.slice(sep + 3);
    // Push pod admin credentials (admin má zápis do všech rep); vlastník repa je
    // actor.username, autor commitu se nastavuje zvlášť v initLocal.
    return `${scheme}${encodeURIComponent(user)}:${adminToken}@${host}/${actor.username}/${name}.git`;
  }
}
