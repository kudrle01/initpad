import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Clock3,
  ScrollText,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type AuditEventFilters } from '@/api';
import { useAuth } from '@/auth';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { List, listRowClassName, listRowInteractiveClassName } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { PageHeader } from '@/components/molecules/PageHeader';
import { useLoadable } from '@/hooks/useLoadable';
import { cn } from '@/lib/utils';
import type { AuditEvent, AuditEventPage } from '@/types';
import { t, msg, formatDateTime, relativeTime, type MessageKey } from '@/i18n';
import { statusLabel, termLabel } from '@/i18n/labels';

const EMPTY_PAGE: AuditEventPage = { items: [], nextCursor: null };

const ACTION_LABELS: Record<string, MessageKey> = {
  'workspace.created': msg('Workspace created'),
  'workspace.updated': msg('Workspace updated'),
  'workspace.production_policy_changed': msg('Production policy changed'),
  'workspace.metrics_exported': msg('Workspace metrics exported'),
  'workspace.member_added': msg('Member added'),
  'workspace.member_role_changed': msg('Member role changed'),
  'workspace.member_removed': msg('Member removed'),
  'project.created': msg('Project created'),
  'project.imported': msg('Project imported'),
  'project.creation_requested': msg('Project creation requested'),
  'project.creation_completed': msg('Project creation completed'),
  'project.import_requested': msg('Project import requested'),
  'project.import_completed': msg('Project import completed'),
  'project.deleted': msg('Project deleted'),
  'environment.target_changed': msg('Environment target changed'),
  'environment.promotion_requested': msg('Promotion requested'),
  'environment.promotion_completed': msg('Promotion completed'),
  'environment.rollback_requested': msg('Rollback requested'),
  'environment.rollback_completed': msg('Rollback completed'),
  'environment.deployment_requested': msg('Deployment requested'),
  'environment.deployment_completed': msg('Deployment completed'),
  'environment.start_requested': msg('Start requested'),
  'environment.start_completed': msg('Start completed'),
  'environment.stop_requested': msg('Stop requested'),
  'environment.stop_completed': msg('Stop completed'),
  'environment.teardown_requested': msg('Removal requested'),
  'environment.teardown_completed': msg('Removal completed'),
  'environment.diagnostic_requested': msg('Diagnostics requested'),
  'environment.expired': msg('Environment lifetime expired'),
  'production.requested': msg('Production requested'),
  'production.request_approved': msg('Production request approved'),
  'production.approval_accepted': msg('Production approval accepted'),
  'production.approval_failed': msg('Production approval failed'),
  'production.request_rejected': msg('Production request rejected'),
  'production.request_cancelled': msg('Production request cancelled'),
  'production.request_stale': msg('Production request became stale'),
  'target.created': msg('Target created'),
  'target.updated': msg('Target updated'),
  'target.connected': msg('Target connected'),
  'target.disconnected': msg('Target disconnected'),
  'target.retired': msg('Target retired'),
  'target.restored': msg('Target restored'),
  'target.deleted': msg('Target deleted'),
  'allocation.created': msg('Allocation created'),
  'allocation.updated': msg('Allocation updated'),
  'allocation.deleted': msg('Allocation deleted'),
  'agent.enrollment_issued': msg('Agent enrollment issued'),
  'agent.disabled': msg('Agent disabled'),
  'agent.update_requested': msg('Agent update requested'),
  'agent.update_completed': msg('Agent update completed'),
};

// Title-cases an API identifier ("agent_job" → "Agent Job"); Czech uses the
// shared vocabulary where it knows the term.
function label(value: string): string {
  const term = termLabel(value);
  const text = term === value ? statusLabel(value) : term;
  if (text !== value) return text.charAt(0).toUpperCase() + text.slice(1);
  return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventLabel(action: string): string {
  const known = ACTION_LABELS[action];
  return known ? t(known) : label(action);
}

const OUTCOME_BADGE = {
  accepted: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'default',
} satisfies Record<AuditEvent['outcome'], BadgeProps['variant']>;

const OUTCOME_CHIP: Record<AuditEvent['outcome'], string> = {
  accepted: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

const OUTCOME_ICONS = {
  accepted: Clock3,
  succeeded: CheckCircle2,
  failed: CircleX,
  cancelled: Ban,
} satisfies Record<AuditEvent['outcome'], typeof Clock3>;

// One event is one line: what happened, to what, by whom, when. The linked
// operation and the recorded details open on demand.
function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const exactTime = formatDateTime(event.createdAt);
  const details = Object.entries(event.details ?? {});
  const OutcomeIcon = OUTCOME_ICONS[event.outcome];
  const operationLink = event.operation?.projectId
    ? event.operation.type === 'deployment'
      ? `/projects/${event.operation.projectId}/deployments`
      : `/projects/${event.operation.projectId}`
    : null;
  const operationSummary = event.operation
    ? `${label(event.operation.type)} · ${label(event.operation.status)}${
        event.operation.phase && event.operation.phase !== event.operation.status
          ? ` · ${label(event.operation.phase)}`
          : ''
      }`
    : '';
  const actor = event.actor.userId
    ? `${event.actor.displayName || event.actor.username} (@${event.actor.username})`
    : event.actor.displayName || t('InitPad system');
  const resource = `${label(event.resource.type)}: ${
    event.resource.name || event.resource.id || t('unknown')
  }`;
  const expandable = Boolean(event.operation) || details.length > 0;

  const summary = (
    <>
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          OUTCOME_CHIP[event.outcome],
        )}
      >
        <OutcomeIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{eventLabel(event.action)}</span>
          {/* The tinted icon already carries the outcome on a narrow screen. */}
          <Badge variant={OUTCOME_BADGE[event.outcome]} className="hidden px-2 py-0 sm:inline-flex">
            {statusLabel(event.outcome)}
          </Badge>
          <span className="sr-only sm:hidden">{statusLabel(event.outcome)}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[45%] shrink-0 truncate" title={actor}>
            {actor}
          </span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate" title={resource}>
            {resource}
          </span>
        </span>
      </span>
      <time
        dateTime={event.createdAt}
        title={exactTime}
        className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
      >
        {relativeTime(event.createdAt)}
      </time>
    </>
  );

  return (
    <li>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={cn(listRowClassName, listRowInteractiveClassName, 'w-full text-left')}
        >
          {summary}
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className={listRowClassName}>
          {summary}
          <span className="w-4 shrink-0" aria-hidden="true" />
        </div>
      )}
      {open && (
        <div className="space-y-3 bg-muted/50 px-4 pb-4 pt-3 text-xs sm:pl-[4.5rem] sm:pr-6">
          {event.operation &&
            (operationLink ? (
              <Link
                to={operationLink}
                state={{ deploymentHistoryOrigin: 'audit' }}
                className="text-link inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 font-medium"
              >
                <span>{operationSummary}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {event.operation.id.slice(0, 8)}
                </span>
              </Link>
            ) : (
              <p className="break-words text-muted-foreground">
                {operationSummary} · {event.operation.id.slice(0, 8)}
              </p>
            ))}
          {details.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              {details.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{label(key)}</dt>
                  <dd className="min-w-0 break-words font-medium">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

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
          {Object.entries(ACTION_LABELS).map(([value, text]) => (
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
                <EventRow key={event.id} event={event} />
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
