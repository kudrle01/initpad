import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { AuthCard } from '@/components/molecules/AuthCard';
import { MissingLinkToken } from '@/components/molecules/MissingLinkToken';
import { Notice } from '@/components/molecules/Notice';
import { Button } from '@/components/ui/button';
import { useLinkToken } from '@/lib/link-token';
import { roleLabel } from '@/i18n/labels';
import { formatDateTime, t } from '@/i18n';
import type { InvitationPreview } from '@/types';
import { pendingInvitation, rememberInvitation } from '@/lib/pending-invitation';

// Public page reached from a workspace invitation (/invite#token, ADR-188).
export default function Invite() {
  const linkToken = useLinkToken();
  const [token] = useState(() => linkToken || pendingInvitation());
  const { user, loading, refreshWorkspaces, switchWorkspace } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    rememberInvitation(token);
    api
      .previewInvitation(token)
      .then(setPreview)
      .catch((e) => {
        rememberInvitation(null);
        setError((e as Error).message);
      });
  }, [token]);

  if (!token) return <MissingLinkToken title={t('Invitation not available')} />;

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const joined = await api.acceptInvitation(token);
      rememberInvitation(null);
      await refreshWorkspaces().catch(() => undefined);
      switchWorkspace(joined.workspaceId, '/');
    } catch (e) {
      setError((e as Error).message);
      setAccepting(false);
    }
  }

  function decline() {
    rememberInvitation(null);
    void navigate(user ? '/' : '/login', { replace: true });
  }

  if (error && !preview) {
    return (
      <AuthCard align="center" title={t('Invitation not available')} description={error}>
        <Button asChild className="mt-6 w-full">
          <Link to="/">{t('Go to InitPad')}</Link>
        </Button>
      </AuthCard>
    );
  }

  if (!preview || loading) {
    return (
      <AuthCard align="center" title={t('Opening the invitation…')}>
        <p role="status" className="mt-4 text-center text-sm text-muted-foreground">
          {t('This only takes a moment.')}
        </p>
      </AuthCard>
    );
  }

  const description = preview.invitedBy
    ? t('{inviter} invited you to {workspace} as {role}.', {
        inviter: preview.invitedBy,
        workspace: preview.workspaceName,
        role: roleLabel(preview.role),
      })
    : t('You are invited to {workspace} as {role}.', {
        workspace: preview.workspaceName,
        role: roleLabel(preview.role),
      });

  return (
    <AuthCard
      align="center"
      title={t('Join {workspace}', { workspace: preview.workspaceName })}
      description={description}
    >
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t('Sent to {email} · valid until {date}', {
          email: preview.email,
          date: formatDateTime(preview.expiresAt),
        })}
      </p>
      {error && (
        <Notice tone="danger" role="alert" className="mt-5 text-left">
          {error}
        </Notice>
      )}
      {user ? (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-center text-sm text-muted-foreground">
            {t('You will join as @{username}.', { username: user.username })}
          </p>
          <Button disabled={accepting} onClick={() => void accept()}>
            {accepting ? t('Please wait…') : t('Accept invitation')}
          </Button>
          <Button variant="ghost" disabled={accepting} onClick={decline}>
            {t('Not now')}
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          <Button asChild>
            <Link to="/login?next=%2Finvite">{t('Sign in to accept')}</Link>
          </Button>
          <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
            {t(
              'No account yet? Create one on the sign-in page, confirm your e-mail, then open this invitation link again.',
            )}
          </p>
        </div>
      )}
    </AuthCard>
  );
}
