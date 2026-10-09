import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { List } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { AuditEventRow, PLATFORM_ACTION_LABELS } from '@/components/organisms/AuditEventRow';
import { cn } from '@/lib/utils';
import type { AuditEvent } from '@/types';
import { t } from '@/i18n';

/**
 * Platform audit (ADR-142): sign-ins, account administration and workspace
 * deletions. Workspace events stay in the workspace Audit log.
 */
export function PlatformAuditCard() {
  const [action, setAction] = useState('');
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  // A newer load wins over a slower earlier one, for example after a filter change.
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const page = await api.adminListAuditEvents({ action: action || undefined });
      if (request !== sequence.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (request === sequence.current) setError((cause as Error).message);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [action]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const request = ++sequence.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.adminListAuditEvents({
        action: action || undefined,
        cursor: nextCursor,
      });
      if (request !== sequence.current) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (request === sequence.current) setMoreError((cause as Error).message);
    } finally {
      if (request === sequence.current) setLoadingMore(false);
    }
  }

  return (
    <SettingsSection
      icon={ShieldCheck}
      title={t('Security log')}
      description={t('Sign-ins, account administration and deleted workspaces, newest first.')}
      flush={!error && !loading && items.length > 0}
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            aria-label={t('Filter by action')}
            className="h-8 w-auto text-xs"
          >
            <option value="">{t('All actions')}</option>
            {Object.entries(PLATFORM_ACTION_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {t(text)}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> {t('Refresh')}
          </Button>
        </div>
      }
    >
      {error ? (
        <LoadErrorState message={error} onRetry={load} />
      ) : loading ? (
        <ContentLoading label={t('Loading security log')} count={3} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No security events yet.')}</p>
      ) : (
        <div className="flex flex-col">
          <List>
            {items.map((event) => (
              <AuditEventRow key={event.id} event={event} />
            ))}
          </List>
          {moreError && (
            <Notice tone="danger" role="alert" className="m-4">
              {moreError}
            </Notice>
          )}
          {nextCursor && (
            <Button
              variant="secondary"
              className="m-4 self-center"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? t('Loading…') : t('Load more')}
            </Button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
