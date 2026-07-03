import { useState } from 'react';
import { GitBranch, KeyRound, ExternalLink, ShieldAlert } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CopyField } from '@/components/molecules/CopyField';
import { Spinner } from '@/components/atoms/Spinner';

interface GitAccess {
  username: string;
  token: string | null;
  giteaUrl: string;
}

// Sestaví jednorázový příkaz: git přepíše každou http URL Gitey tak, že do ní
// vloží uživatele + token → následné clone/pull/push jedou bez zadávání hesla.
function setupCommand(a: GitAccess): string {
  const base = a.giteaUrl.replace(/\/+$/, '');
  const creds = base.replace('://', `://${encodeURIComponent(a.username)}:${a.token}@`);
  return `git config --global url."${creds}/".insteadOf "${base}/"`;
}

export default function Settings() {
  const [access, setAccess] = useState<GitAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      setAccess(await api.getGitAccess());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Connect Git</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Link your machine to the platform’s Git server <strong className="font-medium text-foreground">once</strong>.
              After that, cloning, pulling and pushing private repositories just works — no
              password prompts.
            </p>
          </div>
        </div>

        <div className="mt-5">
          {!access && (
            <Button onClick={reveal} disabled={loading}>
              {loading ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {loading ? 'Loading…' : 'Show setup command'}
            </Button>
          )}

          {error && (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          )}

          {access && access.token && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Run this once in your terminal:
              </p>
              <CopyField command={setupCommand(access)} />
              <p className="text-sm text-muted-foreground">
                Then clone any project with the plain URL shown on its page — it authenticates
                automatically:
              </p>
              <CopyField command={`git clone ${access.giteaUrl}/${access.username}/<project>.git`} />

              <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  The command embeds your personal Gitea token in <code className="font-mono">~/.gitconfig</code>.
                  Keep it private; you can revoke it anytime in{' '}
                  <a
                    href={`${access.giteaUrl}/user/settings/applications`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    Gitea → Settings → Applications <ExternalLink className="h-3 w-3" />
                  </a>
                  .
                </span>
              </div>
            </div>
          )}

          {access && !access.token && (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>
                No personal access token is available for your account. Generate one in Gitea
                (scope <code className="font-mono">repository</code>) and use it as the password
                when cloning:
              </p>
              <a
                href={`${access.giteaUrl}/user/settings/applications`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open Gitea token settings <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
