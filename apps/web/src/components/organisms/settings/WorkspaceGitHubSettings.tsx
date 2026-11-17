import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Github } from 'lucide-react';
import { api, type GitHubStatus } from '@/api';
import { useAuth } from '@/auth';
import { Notice } from '@/components/molecules/Notice';
import { HelpLink } from '@/components/molecules/HelpLink';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import { useConfirmation } from '@/confirmation';
import { t, rich } from '@/i18n';
import { termLabel } from '@/i18n/labels';
import { openGithubWindow, takeGithubResult } from '@/lib/github-window';

// Mirrors the server-side lifetime of one installation setup.
const SETUP_PENDING_MS = 10 * 60 * 1000;

/**
 * GitHub accounts and organizations connected to the active workspace through
 * the InitPad GitHub App. Installations belong to a workspace, so they are
 * added here and only ever serve this workspace (ADR-189: a team workspace
 * connects to organizations only).
 */
export function WorkspaceGitHubSettings() {
  const { activeWorkspace } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [enabled, setEnabled] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [setupBusy, setSetupBusy] = useState(false);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const setupStartedAt = useRef<number | null>(null);
  const requestPending = useRef(false);
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const activeWorkspaceId = activeWorkspace?.id;
  const isTeam = activeWorkspace?.type === 'team';
  const workspaceName = activeWorkspace?.name ?? t('this workspace');
  const personalInstallations =
    status?.installations.filter((installation) => installation.accountType === 'User') ?? [];

  useEffect(() => {
    api
      .authConfig()
      .then((config) => setEnabled(config.githubEnabled))
      .catch(() => undefined);

    const returned = takeGithubResult('/settings/workspace');
    if (returned?.result === 'installed') {
      const account = returned.query.get('account');
      toast.success(
        account
          ? t('GitHub App authorized for {account}', { account })
          : t('GitHub App authorized'),
      );
    } else if (returned?.result === 'installation_requested') {
      toast.success(t('GitHub organization owner has been asked to approve the App'));
    } else if (returned?.result === 'installation_error') {
      toast.error(returned.query.get('reason') || t('Could not authorize GitHub installation'));
    }
  }, [toast]);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId) {
      setStatus(null);
      return;
    }
    let disposed = false;
    let running = false;
    // Recovery is a rate-limited mutation, so a plain return to the window only
    // re-reads the status. It runs on load, while a setup started here can
    // still be pending, and while an org owner has yet to approve a request.
    const setupPending = () =>
      requestPending.current ||
      (setupStartedAt.current !== null && Date.now() - setupStartedAt.current < SETUP_PENDING_MS);
    const refresh = async (recover = setupPending()) => {
      if (running) return;
      running = true;
      try {
        const recovery =
          canAdmin && recover
            ? await api.recoverGithubSetup().catch(() => ({ recovered: false, accountLogin: null }))
            : { recovered: false, accountLogin: null };
        const nextStatus = await api.githubStatus();
        if (!disposed) {
          requestPending.current = nextStatus.installationRequestPending;
          setStatus(nextStatus);
          setSetupBusy(false);
          if (recovery.recovered) {
            setupStartedAt.current = null;
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
    void refresh(true);
    window.addEventListener('focus', refreshWhenFocused);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshWhenFocused);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled, activeWorkspaceId, canAdmin, toast, reloadKey]);

  if (!enabled) return null;

  async function startSetup() {
    const popup = openGithubWindow();
    if (!popup) {
      toast.error(t('Allow pop-ups for InitPad to install the GitHub App'));
      return;
    }
    setSetupBusy(true);
    try {
      const { installUrl } = await api.startGithubSetup();
      setupStartedAt.current = Date.now();
      popup.location.replace(installUrl);
    } catch (error) {
      popup.close();
      toast.error((error as Error).message);
      setSetupBusy(false);
    }
  }

  async function disconnect(installation: GitHubStatus['installations'][number]) {
    const confirmed = await confirmAction({
      title: t('Disconnect {account}?', { account: installation.accountLogin }),
      description: t('{workspace} stops using this GitHub account or organization.', {
        workspace: workspaceName,
      }),
      confirmLabel: t('Disconnect'),
      tone: 'danger',
      consequences: [
        t('The InitPad app stays installed on GitHub, and other workspaces keep using it.'),
        t(
          'Members InitPad invited to the organization for this workspace leave it, unless another of their workspaces uses it.',
        ),
      ],
    });
    if (!confirmed) return;
    setDisconnecting(installation.id);
    try {
      await api.disconnectGithubInstallation(installation.id);
      toast.success(t('{account} disconnected', { account: installation.accountLogin }));
      setReloadKey((key) => key + 1);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDisconnecting(null);
    }
  }

  const connectLabel = isTeam
    ? t('Connect organization')
    : status?.installation.present
      ? t('Add installation')
      : t('Install GitHub App');

  return (
    <SettingsSection
      icon={Github}
      title={t('GitHub')}
      description={
        <>
          {isTeam
            ? t(
                'GitHub organizations whose repositories {workspace} uses. InitPad invites members to them and gives them repository access by their role.',
                { workspace: workspaceName },
              )
            : t('GitHub accounts and organizations whose repositories {workspace} uses.', {
                workspace: workspaceName,
              })}{' '}
          <HelpLink topic="github" />
        </>
      }
      help={[
        {
          title: t('GitHub App'),
          description: t(
            'Gives InitPad access to create or import repositories of the connected account or organization, for this workspace only.',
          ),
        },
        {
          title: t('Permissions'),
          description: t(
            'An organization approves Members read and write, so InitPad can invite team members.',
          ),
        },
      ]}
    >
      {status && !status.linked ? (
        <Notice icon={Github}>
          {rich(
            'Link your GitHub account in <link>account settings</link> first. The connection then uses it to confirm you may connect the account or organization.',
            {
              link: (chunk) => (
                <Link to="/settings/account" className="text-link font-medium">
                  {chunk}
                </Link>
              ),
            },
          )}
        </Notice>
      ) : (
        <>
          {status && status.installations.length > 0 ? (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
              {status.installations.map((installation) => (
                <div
                  key={installation.id}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3.5 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate font-medium" title={installation.accountLogin}>
                    {installation.accountLogin}
                  </span>
                  <span className="min-w-0 break-words text-xs text-muted-foreground">
                    {termLabel(installation.accountType.toLowerCase())} ·{' '}
                    {installation.repositorySelection === 'all'
                      ? t('all repositories')
                      : t('selected repositories')}
                    {installation.suspended ? ` · ${t('suspended')}` : ''}
                  </span>
                  {canAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={disconnecting === installation.id}
                      onClick={() => void disconnect(installation)}
                    >
                      {t('Disconnect')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            status && (
              <p className="text-sm text-muted-foreground">
                {isTeam
                  ? t('No GitHub organization is connected to {workspace} yet.', {
                      workspace: workspaceName,
                    })
                  : t('No GitHub account or organization is connected to {workspace} yet.', {
                      workspace: workspaceName,
                    })}
              </p>
            )
          )}
          {status?.canInstall && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              disabled={setupBusy}
              onClick={startSetup}
            >
              {setupBusy ? t('Opening GitHub…') : connectLabel}
              {!setupBusy && <ExternalLink className="ml-1 h-3.5 w-3.5" />}
            </Button>
          )}
          {status && !status.canInstall && status.appConfigured && !canAdmin && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('A workspace owner or admin connects GitHub accounts and organizations.')}
            </p>
          )}
        </>
      )}

      {isTeam && personalInstallations.length > 0 && (
        <Notice tone="warning" className="mt-3" title={t('Connect a GitHub organization')}>
          {t(
            'This team workspace is connected to the personal GitHub account {account}. Its projects there keep deploying, but while the workspace has them, members cannot be invited or have their role changed. Connect a GitHub organization for new projects.',
            {
              account: personalInstallations
                .map((installation) => installation.accountLogin)
                .join(', '),
            },
          )}
        </Notice>
      )}
      {status?.installationRequestPending && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            'Waiting for a GitHub organization owner to approve the App. The organization connects here once they do.',
          )}
        </p>
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
