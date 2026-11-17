import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Github } from 'lucide-react';
import { api } from '@/api';
import { HelpLink } from '@/components/molecules/HelpLink';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import type { LinkedIdentity } from '@/types';
import { useConfirmation } from '@/confirmation';
import { t, rich, formatDate } from '@/i18n';
import { openGithubWindow, takeGithubResult } from '@/lib/github-window';

/**
 * The GitHub identity of the signed-in account: sign-in, unlink and the user
 * authorization InitPad uses for personal repositories. GitHub App
 * installations belong to a workspace and live in workspace settings.
 */
export function GitHubIntegrationSettings() {
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [enabled, setEnabled] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [credentialReady, setCredentialReady] = useState(true);
  const githubIdentities = identities.filter((identity) => identity.provider === 'github');

  useEffect(() => {
    let disposed = false;
    const refresh = () =>
      api
        .authConfig()
        .then(async (config) => {
          if (disposed) return;
          setEnabled(config.githubEnabled);
          if (!config.githubEnabled) return;
          const [nextIdentities, status] = await Promise.all([
            api.listIdentities(),
            api.githubStatus().catch(() => null),
          ]);
          if (disposed) return;
          setIdentities(nextIdentities);
          setCredentialReady(status?.credentialReady ?? true);
        })
        .catch(() => undefined);

    const returned = takeGithubResult('/settings/account');
    if (returned?.result === 'linked') {
      toast.success(t('GitHub account linked'));
    } else if (returned?.result === 'error') {
      toast.error(returned.query.get('reason') || t('Could not link GitHub account'));
    }
    void refresh();
    // Linking happens in a pop-up; returning to this window shows the result.
    const refreshWhenFocused = () => void refresh();
    window.addEventListener('focus', refreshWhenFocused);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshWhenFocused);
    };
  }, [toast]);

  if (!enabled) return null;

  function linkGithub() {
    if (!openGithubWindow('/api/auth/github?mode=link')) {
      toast.error(t('Allow pop-ups for InitPad to connect GitHub'));
    }
  }

  async function unlinkGithub(identity: LinkedIdentity) {
    const confirmed = await confirmAction({
      title: t('Unlink {account}?', {
        account: identity.username ? `@${identity.username}` : 'GitHub',
      }),
      description: t('This removes the GitHub identity from your InitPad account.'),
      confirmLabel: t('Unlink GitHub'),
      tone: 'danger',
      consequences: [
        t('GitHub sign-in through this identity stops working.'),
        t('Existing projects and GitHub App installations are not deleted.'),
      ],
    });
    if (!confirmed) return;
    setUnlinkingProvider(identity.provider);
    try {
      await api.unlinkIdentity(identity.provider);
      setIdentities((rows) => rows.filter((row) => row.provider !== identity.provider));
      toast.success(t('GitHub account unlinked'));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUnlinkingProvider(null);
    }
  }

  return (
    <SettingsSection
      icon={Github}
      title={t('GitHub account')}
      description={
        <>
          {t('Sign in with GitHub and receive access to your workspaces’ repositories.')}{' '}
          <HelpLink topic="github" />
        </>
      }
    >
      {githubIdentities.length === 0 ? (
        <Button variant="soft" onClick={linkGithub}>
          <Github className="h-4 w-4" /> {t('Link GitHub account')}
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {githubIdentities.map((identity) => (
            <div
              key={identity.provider}
              className="flex flex-col gap-3 p-3.5 sm:flex-row sm:flex-wrap sm:items-center"
            >
              <span className="min-w-0 sm:flex-1 sm:basis-48">
                <span className="block truncate text-sm font-medium">
                  {identity.username ? `@${identity.username}` : 'GitHub'}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {t('linked {date}', { date: formatDate(identity.linkedAt) })}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {!credentialReady && (
                  <Button variant="secondary" size="sm" onClick={linkGithub}>
                    {t('Renew authorization')} <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!identity.canUnlink || unlinkingProvider === identity.provider}
                  title={identity.canUnlink ? undefined : t('This is your only sign-in method')}
                  onClick={() => void unlinkGithub(identity)}
                >
                  {identity.canUnlink ? t('Unlink') : t('Required for sign-in')}
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {rich(
          'GitHub accounts and organizations for repositories are connected per workspace in <link>workspace settings</link>.',
          {
            link: (chunk) => (
              <Link to="/settings/workspace" className="text-link font-medium">
                {chunk}
              </Link>
            ),
          },
        )}
      </p>
    </SettingsSection>
  );
}
