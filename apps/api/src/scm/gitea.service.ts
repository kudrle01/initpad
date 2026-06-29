import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';

const exec = promisify(execFile);

// Založí repo přes Gitea API a pushne do něj scaffold projektu.
// Bez nakonfigurované/dostupné Gitey ponechá lokální složku jako repo.
@Injectable()
export class GiteaService {
  private readonly logger = new Logger('GiteaService');

  async provision(name: string, dir: string): Promise<{ repoUrl: string } | null> {
    const { url, user, token } = config.gitea;
    if (!url || !user || !token) {
      this.logger.warn('Gitea není nakonfigurovaná – ponechávám lokální složku jako repo');
      return null;
    }
    try {
      await this.createRepo(name);
      await this.pushScaffold(name, dir);
      const repoUrl = `${url}/${user}/${name}`;
      this.logger.log(`Repo vytvořeno a nahráno: ${repoUrl}`);
      return { repoUrl };
    } catch (e) {
      this.logger.warn(
        `Gitea nedostupná nebo chyba (${(e as Error).message}) – ponechávám lokální složku`,
      );
      return null;
    }
  }

  get configured(): boolean {
    const { url, user, token } = config.gitea;
    return Boolean(url && user && token);
  }

  // Vrátí commity z Gitea repa, nebo null když není dostupné.
  async listCommits(
    name: string,
    limit = 20,
  ): Promise<{ sha: string; message: string; author: string; date: string }[] | null> {
    const { url, user, token } = config.gitea;
    if (!this.configured) return null;
    try {
      const res = await fetch(
        `${url}/api/v1/repos/${user}/${name}/commits?limit=${limit}`,
        { headers: { Authorization: `token ${token}` } },
      );
      if (!res.ok) return null;
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

  private async createRepo(name: string): Promise<void> {
    const { url, token } = config.gitea;
    const res = await fetch(`${url}/api/v1/user/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${token}` },
      body: JSON.stringify({ name, private: true, auto_init: false, default_branch: 'main' }),
    });
    // 409 = repo už existuje, pokračujeme pushnutím
    if (!res.ok && res.status !== 409) {
      throw new Error(`vytvoření repa selhalo (HTTP ${res.status})`);
    }
  }

  private async pushScaffold(name: string, dir: string): Promise<void> {
    const { url, user, token } = config.gitea;
    const { authorName, authorEmail } = config.git;
    const git = (args: string[]) => exec('git', args, { cwd: dir });
    await git(['init', '-b', 'main']);
    await git(['add', '-A']);
    await git([
      '-c', `user.name=${authorName}`,
      '-c', `user.email=${authorEmail}`,
      'commit', '-m', 'init: scaffold ze šablony',
    ]);
    await git(['remote', 'add', 'origin', this.authedRemote(name)]);
    await git(['push', '-u', 'origin', 'main']);
  }

  private authedRemote(name: string): string {
    const { url, user, token } = config.gitea;
    const sep = url.indexOf('://');
    const scheme = url.slice(0, sep + 3);
    const host = url.slice(sep + 3);
    return `${scheme}${encodeURIComponent(user)}:${token}@${host}/${user}/${name}.git`;
  }
}
