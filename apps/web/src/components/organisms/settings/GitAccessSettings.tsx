import { useState } from 'react';
import { ExternalLink, GitBranch, KeyRound } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { CopyField } from '@/components/molecules/CopyField';
import { Notice } from '@/components/molecules/Notice';
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
      description="Clone, pull and push from this machine without a password prompt."
      help={[
        {
          title: 'Connection',
          description: 'Link this machine to the platform Git server once.',
        },
        {
          title: 'Authentication',
          description: 'Future clone, pull and push commands work without a password prompt.',
        },
      ]}
    >
      {!access && (
        <Button variant="soft" onClick={reveal} disabled={loading}>
          {loading ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          {loading ? 'Loading…' : 'Show setup command'}
        </Button>
      )}

      {error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {error}
        </Notice>
      )}

      {access?.token && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">1. Run this once in your terminal</p>
          <CopyField command={setupCommand(access)} />
          <p className="mt-1 text-sm font-medium">
            2. Clone any project with the plain URL shown on its page
          </p>
          <CopyField command={`git clone ${access.giteaUrl}/${access.username}/<project>.git`} />
          <Notice tone="warning" className="mt-1">
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
          </Notice>
        </div>
      )}

      {access && !access.token && (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            No personal access token is available. Generate one in Gitea with repository scope and
            use it as the password when cloning.
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
