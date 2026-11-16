import { useEffect, useState } from 'react';
import { MailPlus, Send, X } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { List, ListRow } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { CopyField } from '@/components/molecules/CopyField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/toast';
import { useConfirmation } from '@/confirmation';
import type { WorkspaceInvitation, WorkspaceRole } from '@/types';
import { formatDate, t, msg, type MessageKey } from '@/i18n';
import { roleLabel } from '@/i18n/labels';

type AssignableRole = Exclude<WorkspaceRole, 'owner'>;
const ROLES: Array<{ value: AssignableRole; label: MessageKey }> = [
  { value: 'member', label: msg('Member') },
  { value: 'maintainer', label: msg('Maintainer') },
  { value: 'viewer', label: msg('Viewer') },
  { value: 'admin', label: msg('Admin') },
];

/**
 * Consent-based entry to a team workspace (ADR-188): the invitee joins only by
 * accepting the single-use link. Shown to owners and admins of team workspaces.
 */
export function WorkspaceInvitationsSettings() {
  const { activeWorkspace } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [sending, setSending] = useState(false);
  const [manualLink, setManualLink] = useState<{ email: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canManage =
    activeWorkspace?.type === 'team' &&
    (activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin');
  const workspaceId = canManage ? activeWorkspace?.id : undefined;

  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    setInvitations([]);
    setLoading(true);
    setLoadError(null);
    api
      .listWorkspaceInvitations(workspaceId)
      .then((rows) => {
        if (!disposed) setInvitations(rows);
      })
      .catch((error) => {
        if (!disposed) setLoadError((error as Error).message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [workspaceId, reloadKey]);

  if (!canManage || !activeWorkspace) return null;

  async function invite() {
    if (!activeWorkspace) return;
    const address = email.trim();
    if (role === 'admin') {
      const confirmed = await confirmAction({
        title: t('Invite {identity} as workspace admin?', { identity: address }),
        description: t('Administrators can manage members and infrastructure in {name}.', {
          name: activeWorkspace.name,
        }),
        confirmLabel: t('Send admin invitation'),
        tone: 'warning',
      });
      if (!confirmed) return;
    }
    setSending(true);
    setManualLink(null);
    try {
      const created = await api.inviteWorkspaceMember(activeWorkspace.id, address, role);
      setInvitations((rows) => [
        created.invitation,
        ...rows.filter((row) => row.email !== created.invitation.email),
      ]);
      if (created.inviteUrl) {
        setManualLink({ email: created.invitation.email, url: created.inviteUrl });
      } else {
        toast.success(t('Invitation sent to {email}', { email: created.invitation.email }));
      }
      setEmail('');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function revoke(invitation: WorkspaceInvitation) {
    if (!activeWorkspace) return;
    const confirmed = await confirmAction({
      title: t('Cancel the invitation for {email}?', { email: invitation.email }),
      description: t('The link in the e-mail stops working immediately.'),
      confirmLabel: t('Cancel invitation'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusyId(invitation.id);
    try {
      await api.revokeWorkspaceInvitation(activeWorkspace.id, invitation.id);
      setInvitations((rows) => rows.filter((row) => row.id !== invitation.id));
      if (manualLink?.email === invitation.email) setManualLink(null);
      toast.success(t('Invitation for {email} cancelled', { email: invitation.email }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection
      icon={MailPlus}
      title={t('Invitations')}
      description={t(
        'Invite people by e-mail. They join after accepting the link, which works once and expires in 7 days.',
      )}
      flush
    >
      <div className="border-b border-border/70 bg-muted/50 px-4 py-4 sm:px-6">
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim() && !sending) void invite();
          }}
        >
          <Input
            type="email"
            placeholder={t('E-mail')}
            aria-label={t('E-mail address to invite')}
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select
            aria-label={t('Role for the invitation')}
            value={role}
            onChange={(event) => setRole(event.target.value as AssignableRole)}
          >
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={sending || !email.trim()}>
            <Send className="h-4 w-4" /> {t('Send invitation')}
          </Button>
        </form>
        {manualLink && (
          <div className="mt-3 flex flex-col gap-2">
            <Notice tone="warning">
              {t(
                'E-mail delivery is not configured. Send this link to {email} yourself; it works once.',
                { email: manualLink.email },
              )}
            </Notice>
            <CopyField command={manualLink.url} />
          </div>
        )}
      </div>

      {loadError ? (
        <div className="p-4 sm:p-6">
          <LoadErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
        </div>
      ) : loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          {t('Loading invitations…')}
        </p>
      ) : invitations.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          {t('No pending invitations.')}
        </p>
      ) : (
        <List>
          {invitations.map((invitation) => (
            <ListRow key={invitation.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={invitation.email}>
                  {invitation.email}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('Valid until {date}', { date: formatDate(invitation.expiresAt) })}
                </span>
              </span>
              <Badge>{roleLabel(invitation.role)}</Badge>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full hover:bg-destructive/10 hover:text-destructive"
                aria-label={t('Cancel the invitation for {email}', { email: invitation.email })}
                title={t('Cancel the invitation for {email}', { email: invitation.email })}
                disabled={busyId === invitation.id}
                onClick={() => void revoke(invitation)}
              >
                <X className="h-4 w-4" />
              </Button>
            </ListRow>
          ))}
        </List>
      )}
    </SettingsSection>
  );
}
