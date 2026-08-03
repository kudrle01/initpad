import { useState } from 'react';
import { ExternalLink, GitBranch, KeyRound, ShieldAlert } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { CopyField } from '@/components/molecules/CopyField';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Spinner } from '@/components/atoms/Spinner';
import { Button } from '@/components/ui/button';

interface GitAccess {
  username: string;
  token: string | null;
  giteaUrl: string;
}

function setupCommand(access: GitAccess): string {
  const base = access.giteaUrl.replace(/\/+$/, '');
  const credentials = base.replace(
    '://',
    `://${encodeURIComponent(access.username)}:${access.token}@`,
  );
  return `git config --global url."${credentials}/".insteadOf "${base}/"`;
}

export function GitAccessSettings() {
  const { user } = useAuth();
  const [access, setAccess] = useState<GitAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user?.edition !== 'self-hosted') return null;

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      setAccess(await api.getGitAccess());
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsSection
      icon={GitBranch}
      title="Connect Git"
      description={
        <>
          Link your machine to the platform’s Git server <strong className="font-medium text-foreground">once</strong>.
          {' '}After that, cloning, pulling and pushing private repositories works without password prompts.
        </>
      }
    >
      {!access && (
        <Button onClick={reveal} disabled={loading}>
          {loading ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          {loading ? 'Loading…' : 'Show setup command'}
        </Button>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {access?.token && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Run this once in your terminal:</p>
          <CopyField command={setupCommand(access)} />
          <p className="text-sm text-muted-foreground">
            Then clone any project with the plain URL shown on its page:
          </p>
          <CopyField command={`git clone ${access.giteaUrl}/${access.username}/<project>.git`} />
          <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              The command embeds your personal Gitea token in{' '}
              <code className="font-mono">~/.gitconfig</code>. Keep it private; you can revoke it
              anytime in{' '}
              <a
                href={`${access.giteaUrl}/user/settings/applications`}
                target="_blank"
                rel="noreferrer"
                className="text-link inline-flex items-center gap-0.5"
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
            No personal access token is available. Generate one in Gitea with repository scope
            and use it as the password when cloning.
          </p>
          <a
            href={`${access.giteaUrl}/user/settings/applications`}
            target="_blank"
            rel="noreferrer"
            className="text-link inline-flex items-center gap-1 font-medium"
          >
            Open Gitea token settings <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </SettingsSection>
  );
}
