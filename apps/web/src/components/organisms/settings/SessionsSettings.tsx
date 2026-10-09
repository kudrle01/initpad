import { useCallback, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { api } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { List } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { useLoadable } from '@/hooks/useLoadable';
import { useToast } from '@/toast';
import type { UserSessionSummary } from '@/types';
import { plural, relativeTime, t } from '@/i18n';

// "Firefox · Linux" from a User-Agent header; enough to recognise a device.
export function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return t('Unknown browser');
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const system = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return [browser, system].filter(Boolean).join(' · ') || t('Unknown browser');
}

/** Signed-in browsers of the account; any other one can be signed out (ADR-147). */
export function SessionsSettings() {
  const toast = useToast();
  const loader = useCallback(() => api.listSessions(), []);
  const { data: sessions, loading, error, reload } = useLoadable<UserSessionSummary[]>(loader, []);
  const [busy, setBusy] = useState<string | null>(null);
  const others = sessions.filter((session) => !session.current);

  // `target` is a session id, or 'others' for every session but this one.
  async function end(target: string) {
    setBusy(target);
    try {
      const { ended } =
        target === 'others' ? await api.endOtherSessions() : await api.endSession(target);
      toast.success(plural('{count} sessions signed out', ended));
      await reload();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection
      icon={MonitorSmartphone}
      title={t('Signed-in browsers')}
      description={t(
        'Browsers where your account is signed in. Sign out any you do not recognise, then change your password.',
      )}
      flush={!error && !loading && sessions.length > 0}
      actions={
        others.length > 1 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => void end('others')}
          >
            {t('Sign out all others')}
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label={t('Loading sessions')} count={2} />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('This browser signed in before session tracking was added.')}
        </p>
      ) : (
        <List>
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {describeBrowser(session.userAgent)}
                  {session.current && <Badge>{t('This browser')}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('Signed in {time}', { time: relativeTime(session.createdAt) })}
                </p>
              </div>
              {!session.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void end(session.id)}
                >
                  {t('Sign out')}
                </Button>
              )}
            </li>
          ))}
        </List>
      )}
    </SettingsSection>
  );
}
