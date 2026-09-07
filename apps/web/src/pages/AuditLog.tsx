import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, CircleX, Clock3, ScrollText, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type AuditEventFilters } from '@/api';
import { useAuth } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { useLoadable } from '@/hooks/useLoadable';
import type { AuditEvent, AuditEventPage } from '@/types';

const EMPTY_PAGE: AuditEventPage = { items: [], nextCursor: null };

const ACTION_LABELS: Record<string, string> = {
  'workspace.created': 'Workspace created',
  'workspace.updated': 'Workspace updated',
  'workspace.production_policy_changed': 'Production policy changed',
  'workspace.member_added': 'Member added',
  'workspace.member_role_changed': 'Member role changed',
  'workspace.member_removed': 'Member removed',
  'project.created': 'Project created',
  'project.imported': 'Project imported',
  'project.creation_requested': 'Project creation requested',
  'project.creation_completed': 'Project creation completed',
  'project.import_requested': 'Project import requested',
  'project.import_completed': 'Project import completed',
  'project.deleted': 'Project deleted',
  'environment.target_changed': 'Environment target changed',
  'environment.promotion_requested': 'Promotion requested',
  'environment.promotion_completed': 'Promotion completed',
  'environment.rollback_requested': 'Rollback requested',
  'environment.rollback_completed': 'Rollback completed',
  'environment.deployment_requested': 'Deployment requested',
  'environment.deployment_completed': 'Deployment completed',
  'environment.start_requested': 'Start requested',
  'environment.start_completed': 'Start completed',
  'environment.stop_requested': 'Stop requested',
  'environment.stop_completed': 'Stop completed',
  'environment.teardown_requested': 'Removal requested',
  'environment.teardown_completed': 'Removal completed',
  'environment.diagnostic_requested': 'Diagnostics requested',
  'production.requested': 'Production requested',
  'production.request_approved': 'Production request approved',
  'production.approval_accepted': 'Production approval accepted',
  'production.approval_failed': 'Production approval failed',
  'production.request_rejected': 'Production request rejected',
  'production.request_cancelled': 'Production request cancelled',
  'production.request_stale': 'Production request became stale',
  'target.created': 'Target created',
  'target.updated': 'Target updated',
  'target.connected': 'Target connected',
  'target.disconnected': 'Target disconnected',
  'target.retired': 'Target retired',
  'target.restored': 'Target restored',
  'target.deleted': 'Target deleted',
  'allocation.created': 'Allocation created',
  'allocation.updated': 'Allocation updated',
  'allocation.deleted': 'Allocation deleted',
  'agent.enrollment_issued': 'Agent enrollment issued',
  'agent.disabled': 'Agent disabled',
};

function label(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventLabel(action: string): string {
  return ACTION_LABELS[action] ?? label(action);
}

function relativeTime(iso: string): string {
  const milliseconds = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(milliseconds)) return '';
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString('en-GB');
}

const OUTCOME_STYLES: Record<AuditEvent['outcome'], string> = {
  accepted: 'border-warning/40 bg-warning/10 text-warning',
  succeeded: 'border-success/30 bg-success/10 text-success',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-secondary text-muted-foreground',
};

const OUTCOME_ICONS = {
  accepted: Clock3,
  succeeded: CheckCircle2,
  failed: CircleX,
  cancelled: Ban,
} satisfies Record<AuditEvent['outcome'], typeof Clock3>;

function EventCard({ event }: { event: AuditEvent }) {
  const exactTime = new Date(event.createdAt).toLocaleString();
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

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
          <OutcomeIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{eventLabel(event.action)}</h2>
            <Badge
              variant="outline"
              className={OUTCOME_STYLES[event.outcome]}
            >
              {event.outcome}
            </Badge>
            <time
              dateTime={event.createdAt}
              title={exactTime}
              className="text-xs text-muted-foreground sm:ml-auto"
            >
              {relativeTime(event.createdAt)}
            </time>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {event.actor.userId
                  ? `${event.actor.displayName || event.actor.username} (@${event.actor.username})`
                  : event.actor.displayName || 'InitPad system'}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="break-all">
              {label(event.resource.type)}: {event.resource.name || event.resource.id || 'unknown'}
            </span>
          </div>
          {event.operation && (
            <div className="mt-2 text-xs">
              {operationLink ? (
                <Link
                  to={operationLink}
                  state={{ deploymentHistoryOrigin: 'audit' }}
                  className="text-link inline-flex min-w-0 items-center gap-1 font-medium"
                >
                  <span>{operationSummary}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {event.operation.id.slice(0, 8)}
                  </span>
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  {operationSummary} · {event.operation.id.slice(0, 8)}
                </span>
              )}
            </div>
          )}
          {details.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-secondary/50 px-3 py-2 text-xs">
              {details.map(([key, value]) => (
                <div key={key} className="flex min-w-0 gap-1">
                  <dt className="text-muted-foreground">{label(key)}:</dt>
                  <dd className="break-all font-medium">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </article>
  );
}

export default function AuditLog() {
  const { activeWorkspace } = useAuth();
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [outcome, setOutcome] = useState<'' | AuditEvent['outcome']>('');
  const [additionalItems, setAdditionalItems] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadMoreSequence = useRef(0);

  const filters: AuditEventFilters = {
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(outcome ? { outcome } : {}),
    limit: 30,
  };
  const loadFirstPage = useCallback(
    () => api.getAuditEvents(filters),
    [activeWorkspace?.id, action, resourceType, outcome],
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
        title="Audit log"
        help={[
          {
            title: 'Records',
            description: 'Workspace changes with immutable actor and resource snapshots.',
          },
          {
            title: 'Privacy',
            description: 'Secrets, configuration values and application logs are never stored here.',
          },
        ]}
      />

      <div className="mb-5 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
        <Select value={action} onChange={(event) => setAction(event.target.value)} aria-label="Filter by action">
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </Select>
        <Select value={resourceType} onChange={(event) => setResourceType(event.target.value)} aria-label="Filter by resource">
          <option value="">All resources</option>
          <option value="workspace">Workspace</option>
          <option value="member">Member</option>
          <option value="project">Project</option>
          <option value="target">Target</option>
          <option value="allocation">Allocation</option>
          <option value="agent">Agent</option>
        </Select>
        <Select
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          aria-label="Filter by outcome"
        >
          <option value="">All outcomes</option>
          <option value="accepted">Accepted</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label="Loading audit log" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? 'No matching events' : 'No audit events yet'}
          description={filtered
            ? 'Change or clear the filters to see other workspace events.'
            : 'Security-relevant workspace changes will appear here.'}
          action={filtered ? (
            <Button
              variant="secondary"
              onClick={() => {
                setAction('');
                setResourceType('');
                setOutcome('');
              }}
            >
              Clear filters
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((event) => <EventCard key={event.id} event={event} />)}
          {moreError && <p role="alert" className="text-sm text-destructive">{moreError}</p>}
          {nextCursor && (
            <Button variant="secondary" className="self-center" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
