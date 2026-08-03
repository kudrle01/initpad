import { useEffect, useState } from 'react';
import { CircleCheck, ExternalLink, Github, ShieldAlert } from 'lucide-react';
import { api, type GitHubStatus } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import type { LinkedIdentity } from '@/types';

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
  popup.document.title = 'Opening GitHub…';
  popup.document.body.textContent = 'Opening GitHub…';
  if (url) popup.location.replace(url);
  popup.focus();
  return popup;
}

export function GitHubIntegrationSettings() {
  const { activeWorkspace } = useAuth();
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const githubIdentities = identities.filter((identity) => identity.provider === 'github');

  useEffect(() => {
    api.authConfig()
      .then((config) => {
        setEnabled(config.githubEnabled);
        if (config.githubEnabled) {
          api.listIdentities().then(setIdentities).catch(() => undefined);
        }
      })
      .catch(() => undefined);

    const query = new URLSearchParams(window.location.search);
    const result = query.get('github');
    if (result === 'linked') {
      toast.success('GitHub account linked');
      api.listIdentities().then(setIdentities).catch(() => undefined);
    } else if (result === 'installed') {
      const account = query.get('account');
      toast.success(`GitHub App authorized${account ? ` for ${account}` : ''}`);
    } else if (result === 'installation_requested') {
      toast.success('GitHub organization owner has been asked to approve the App');
    } else if (result === 'installation_error') {
      toast.error(query.get('reason') || 'Could not authorize GitHub installation');
    } else if (result === 'error') {
      toast.error(query.get('reason') || 'Could not link GitHub account');
    }
    if (result) window.history.replaceState({}, '', '/settings');
  }, []);

  useEffect(() => {
    if (!enabled || !activeWorkspace) {
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
              `GitHub App authorized${recovery.accountLogin ? ` for ${recovery.accountLogin}` : ''}`,
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
  }, [enabled, activeWorkspace?.id, canAdmin]);

  if (!enabled) return null;

  function linkGithub() {
    if (!openGithubWindow('/api/auth/github?mode=link')) {
      toast.error('Allow pop-ups for InitPad to connect GitHub');
    }
  }

  async function startSetup() {
    const popup = openGithubWindow();
    if (!popup) {
      toast.error('Allow pop-ups for InitPad to install the GitHub App');
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

  async function unlinkGithub(provider: string) {
    if (!window.confirm('Unlink this GitHub account from InitPad?')) return;
    try {
      await api.unlinkIdentity(provider);
      setIdentities((rows) => rows.filter((identity) => identity.provider !== provider));
      toast.success('GitHub account unlinked');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <SettingsSection
      icon={Github}
      title="GitHub account"
      description="Link GitHub to sign in and use an installed GitHub App to create or import repositories."
    >
      {githubIdentities.length === 0 ? (
        <Button variant="secondary" onClick={linkGithub}>
          <Github className="h-4 w-4" /> Link GitHub account
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {githubIdentities.map((identity) => (
            <div key={identity.provider} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {identity.username ? `@${identity.username}` : 'GitHub'}
                  {status?.installation.present && !status.installation.suspended && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-success">
                      <CircleCheck className="h-3.5 w-3.5" /> App authorized
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  linked {new Date(identity.linkedAt).toLocaleDateString()}
                  {status && (
                    status.installation.suspended
                      ? ' · App installation suspended'
                      : status.installation.present
                        ? ' · App installed'
                        : ' · App not installed'
                  )}
                </span>
              </span>
              {status?.canInstall && (
                <Button variant="secondary" size="sm" disabled={setupBusy} onClick={startSetup}>
                  {setupBusy
                    ? 'Opening GitHub…'
                    : status.installation.present
                      ? 'Add installation'
                      : 'Install GitHub App'}
                  {!setupBusy && <ExternalLink className="ml-1 h-3.5 w-3.5" />}
                </Button>
              )}
              {status && !status.credentialReady && (
                <Button variant="secondary" size="sm" onClick={linkGithub}>
                  Renew authorization <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!identity.canUnlink}
                title={identity.canUnlink ? undefined : 'This is your only sign-in method'}
                onClick={() => unlinkGithub(identity.provider)}
              >
                {identity.canUnlink ? 'Unlink' : 'Required for sign-in'}
              </Button>
            </div>
          ))}
          {status?.installations.map((installation) => (
            <div
              key={installation.id}
              className="flex flex-wrap items-center gap-2 bg-secondary/30 px-3 py-2 text-xs"
            >
              <span className="font-medium">{installation.accountLogin}</span>
              <span className="text-muted-foreground">
                {installation.accountType.toLowerCase()} · {installation.repositorySelection} repositories
                {installation.suspended
                  ? ' · suspended'
                  : ` · authorized for ${activeWorkspace?.name ?? 'workspace'}`}
              </span>
            </div>
          ))}
          <div className="bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
            Failed-job retry requires GitHub repository permission{' '}
            <strong className="font-medium text-foreground">Actions: Read and write</strong>.
            No organization or account permission is required.
          </div>
        </div>
      )}

      {status && !status.appConfigured && (
        <p className="mt-2 text-xs text-muted-foreground">
          GitHub sign-in is available, but repository access has not been configured by the platform administrator.
        </p>
      )}
      {status && !status.ciCallbackReady && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-muted-foreground"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            GitHub delivery is paused: {status.ciCallbackIssue} The platform administrator must
            configure a public HTTPS <code className="font-mono">INITPAD_PUBLIC_URL</code>.
            Current value: <code className="font-mono">{status.ciCallbackUrl ?? 'not set'}</code>.
          </span>
        </p>
      )}
    </SettingsSection>
  );
}
