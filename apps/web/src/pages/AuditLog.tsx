import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api, type AuditEventFilters } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { List } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AUDIT_ACTION_LABELS, AuditEventRow } from '@/components/organisms/AuditEventRow';
import { useLoadable } from '@/hooks/useLoadable';
import type { AuditEvent, AuditEventPage } from '@/types';
import { t } from '@/i18n';

const EMPTY_PAGE: AuditEventPage = { items: [], nextCursor: null };

export default function AuditLog() {
  const { activeWorkspace } = useAuth();
  const workspaceId = activeWorkspace?.id;
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [outcome, setOutcome] = useState<'' | AuditEvent['outcome']>('');
  const [additionalItems, setAdditionalItems] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadMoreSequence = useRef(0);

  const filters = useMemo<AuditEventFilters>(
    () => ({
      ...(action ? { action } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(outcome ? { outcome } : {}),
      limit: 30,
    }),
    [action, resourceType, outcome],
  );
  const loadFirstPage = useCallback(
    () => (workspaceId ? api.getAuditEvents(filters) : Promise.resolve(EMPTY_PAGE)),
    [workspaceId, filters],
  );
  const { data, loading, error, reload } = useLoadable(loadFirstPage, EMPTY_PAGE);

  useEffect(() => {
    loadMoreSequence.current += 1;
    setAdditionalItems([]);
    setNextCursor(data.nextCursor);
    setMoreError(null);
  }, [data]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const request = ++loadMoreSequence.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.getAuditEvents({ ...filters, cursor: nextCursor });
      if (request !== loadMoreSequence.current) return;
      setAdditionalItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (request === loadMoreSequence.current) setMoreError((cause as Error).message);
    } finally {
      if (request === loadMoreSequence.current) setLoadingMore(false);
    }
  }

  const items = [...data.items, ...additionalItems];
  const filtered = Boolean(action || resourceType || outcome);

  return (
    <div>
      <PageHeader
        title={t('Audit log')}
        description={t('Who changed what in this workspace, newest first.')}
        help={[
          {
            title: t('Records'),
            description: t('Workspace changes with immutable actor and resource snapshots.'),
          },
          {
            title: t('Privacy'),
            description: t(
              'Secrets, configuration values and application logs are never stored here.',
            ),
          },
        ]}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          aria-label={t('Filter by action')}
          className="col-span-2 sm:col-span-1"
        >
          <option value="">{t('All actions')}</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {t(text)}
            </option>
          ))}
        </Select>
        <Select
          value={resourceType}
          onChange={(event) => setResourceType(event.target.value)}
          aria-label={t('Filter by resource')}
        >
          <option value="">{t('All resources')}</option>
          <option value="workspace">{t('Workspace')}</option>
          <option value="member">{t('Member')}</option>
          <option value="project">{t('Project')}</option>
          <option value="target">{t('Target')}</option>
          <option value="allocation">{t('Allocation')}</option>
          <option value="agent">{t('Agent')}</option>
        </Select>
        <Select
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          aria-label={t('Filter by outcome')}
        >
          <option value="">{t('All outcomes')}</option>
          <option value="accepted">{t('Accepted')}</option>
          <option value="succeeded">{t('Succeeded')}</option>
          <option value="failed">{t('Failed')}</option>
          <option value="cancelled">{t('Cancelled')}</option>
        </Select>
      </div>

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label={t('Loading audit log')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? t('No matching events') : t('No audit events yet')}
          description={
            filtered
              ? t('Change or clear the filters to see other workspace events.')
              : t('Security-relevant workspace changes will appear here.')
          }
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setAction('');
                  setResourceType('');
                  setOutcome('');
                }}
              >
                {t('Clear filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <List>
              {items.map((event) => (
                <AuditEventRow key={event.id} event={event} />
              ))}
            </List>
          </Card>
          {moreError && (
            <Notice tone="danger" role="alert">
              {moreError}
            </Notice>
          )}
          {nextCursor && (
            <Button
              variant="secondary"
              className="self-center"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? t('Loading…') : t('Load more')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
