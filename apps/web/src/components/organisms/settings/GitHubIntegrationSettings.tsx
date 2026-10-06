import { useEffect, useState } from 'react';
import { CircleCheck, ExternalLink, Github } from 'lucide-react';
import { api, type GitHubStatus } from '@/api';
import { useAuth } from '@/auth';
import { Notice } from '@/components/molecules/Notice';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import type { LinkedIdentity } from '@/types';
import { useConfirmation } from '@/confirmation';
import { t, rich, formatDate } from '@/i18n';
import { termLabel } from '@/i18n/labels';

function openGithubWindow(url?: string): Window | null {
  const width = 760;
  const height = 820;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(
    'about:blank',
    '_blank',
    `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
  );
  if (!popup) return null;
  popup.opener = null;
  popup.document.title = t('Opening GitHub…');
  popup.document.body.textContent = t('Opening GitHub…');
  if (url) popup.location.replace(url);
  popup.focus();
  return popup;
}

export function GitHubIntegrationSettings() {
  const { activeWorkspace } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [enabled, setEnabled] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const activeWorkspaceId = activeWorkspace?.id;
  const githubIdentities = identities.filter((identity) => identity.provider === 'github');

  useEffect(() => {
    api
      .authConfig()
      .then((config) => {
        setEnabled(config.githubEnabled);
        if (config.githubEnabled) {
          api
            .listIdentities()
            .then(setIdentities)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    const query = new URLSearchParams(window.location.search);
    const result = query.get('github');
    if (result === 'linked') {
      toast.success(t('GitHub account linked'));
      api
        .listIdentities()
        .then(setIdentities)
        .catch(() => undefined);
    } else if (result === 'installed') {
      const account = query.get('account');
      toast.success(
        account
          ? t('GitHub App authorized for {account}', { account })
          : t('GitHub App authorized'),
      );
    } else if (result === 'installation_requested') {
      toast.success(t('GitHub organization owner has been asked to approve the App'));
    } else if (result === 'installation_error') {
      toast.error(query.get('reason') || t('Could not authorize GitHub installation'));
    } else if (result === 'error') {
      toast.error(query.get('reason') || t('Could not link GitHub account'));
    }
    if (result) window.history.replaceState({}, '', '/settings/account');
  }, [toast]);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId) {
      setStatus(null);
      return;
    }
    let disposed = false;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const recovery = canAdmin
          ? await api.recoverGithubSetup().catch(() => ({ recovered: false, accountLogin: null }))
          : { recovered: false, accountLogin: null };
        const [nextIdentities, nextStatus] = await Promise.all([
          api.listIdentities(),
          api.githubStatus(),
        ]);
        if (!disposed) {
          setIdentities(nextIdentities);
          setStatus(nextStatus);
          setSetupBusy(false);
          if (recovery.recovered) {
            toast.success(
              recovery.accountLogin
                ? t('GitHub App authorized for {account}', { account: recovery.accountLogin })
                : t('GitHub App authorized'),
            );
          }
        }
      } catch {
        if (!disposed) {
          setStatus(null);
          setSetupBusy(false);
        }
      } finally {
        running = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const refreshWhenFocused = () => void refresh();
    void refresh();
    window.addEventListener('focus', refreshWhenFocused);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshWhenFocused);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled, activeWorkspaceId, canAdmin, toast]);

  if (!enabled) return null;

  function linkGithub() {
    if (!openGithubWindow('/api/auth/github?mode=link')) {
      toast.error(t('Allow pop-ups for InitPad to connect GitHub'));
    }
  }

  async function startSetup() {
    const popup = openGithubWindow();
    if (!popup) {
      toast.error(t('Allow pop-ups for InitPad to install the GitHub App'));
      return;
    }
    setSetupBusy(true);
    try {
      const { installUrl } = await api.startGithubSetup();
      popup.location.replace(installUrl);
    } catch (error) {
      popup.close();
      toast.error((error as Error).message);
      setSetupBusy(false);
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
      description={t('Sign in with GitHub and let InitPad create or import selected repositories.')}
      help={[
        {
          title: t('Account'),
          description: t('Links your GitHub identity as a sign-in method.'),
        },
        {
          title: t('GitHub App'),
          description: t('Gives InitPad access to create or import selected repositories.'),
        },
        {
          title: t('Permissions'),
          description: t(
            'Job retry needs Actions read and write. No organization or account permission is required.',
          ),
        },
      ]}
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
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  <span className="truncate">
                    {identity.username ? `@${identity.username}` : 'GitHub'}
                  </span>
                  {status?.installation.present && !status.installation.suspended && (
                    <Badge variant="success" className="px-2 py-0">
                      <CircleCheck className="h-3 w-3" /> {t('App authorized')}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {t('linked {date}', { date: formatDate(identity.linkedAt) })}
                  {status &&
                    ` · ${
                      status.installation.suspended
                        ? t('App installation suspended')
                        : status.installation.present
                          ? t('App installed')
                          : t('App not installed')
                    }`}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {status?.canInstall && (
                  <Button variant="secondary" size="sm" disabled={setupBusy} onClick={startSetup}>
                    {setupBusy
                      ? t('Opening GitHub…')
                      : status.installation.present
                        ? t('Add installation')
                        : t('Install GitHub App')}
                    {!setupBusy && <ExternalLink className="ml-1 h-3.5 w-3.5" />}
                  </Button>
                )}
                {status && !status.credentialReady && (
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
          {status?.installations.map((installation) => (
            <div
              key={installation.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 bg-muted/60 px-3.5 py-2.5 text-xs"
            >
              <span className="min-w-0 truncate font-medium" title={installation.accountLogin}>
                {installation.accountLogin}
              </span>
              <span className="min-w-0 break-words text-muted-foreground">
                {termLabel(installation.accountType.toLowerCase())} ·{' '}
                {installation.repositorySelection === 'all'
                  ? t('all repositories')
                  : t('selected repositories')}{' '}
                ·{' '}
                {installation.suspended
                  ? t('suspended')
                  : t('authorized for {workspace}', {
                      workspace: activeWorkspace?.name ?? t('this workspace'),
                    })}
              </span>
            </div>
          ))}
        </div>
      )}

      {status && !status.appConfigured && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            'GitHub sign-in is available, but repository access has not been configured by the platform administrator.',
          )}
        </p>
      )}
      {status && !status.ciCallbackReady && (
        <Notice tone="danger" role="alert" className="mt-3" title={t('GitHub delivery is paused')}>
          {rich(
            '{issue} The platform administrator must configure a public HTTPS <code>INITPAD_PUBLIC_URL</code>. Current value: <value>{url}</value>.',
            {
              issue: status.ciCallbackIssue,
              url: status.ciCallbackUrl ?? t('not set'),
              code: (chunk) => <code className="font-mono">{chunk}</code>,
              value: (chunk) => <code className="break-all font-mono">{chunk}</code>,
            },
          )}
        </Notice>
      )}
    </SettingsSection>
  );
}
