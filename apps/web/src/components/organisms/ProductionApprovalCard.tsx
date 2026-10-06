import { Ban, CheckCircle2, Clock3, ExternalLink, ShieldCheck, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProductionDeploymentRequest } from '@/types';
import { t, msg, formatDateTime, type MessageKey } from '@/i18n';
import { statusLabel } from '@/i18n/labels';

const STATUS_VARIANT = {
  pending: 'warning',
  approving: 'warning',
  approved: 'success',
  rejected: 'danger',
  stale: 'default',
  failed: 'danger',
  cancelled: 'default',
} satisfies Record<ProductionDeploymentRequest['status'], BadgeProps['variant']>;

const STATUS_ICON = {
  pending: Clock3,
  approving: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  stale: Ban,
  failed: XCircle,
  cancelled: Ban,
} satisfies Record<ProductionDeploymentRequest['status'], typeof Clock3>;

const REQUEST_TITLE: Record<ProductionDeploymentRequest['kind'], MessageKey> = {
  promote: msg('Production promote request'),
  redeploy: msg('Production redeploy request'),
  rollback: msg('Production rollback request'),
};

function person(person: ProductionDeploymentRequest['requester']): string {
  return person.displayName || `@${person.username}`;
}

interface Props {
  request: ProductionDeploymentRequest;
  projectId: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}

export function ProductionApprovalCard({
  request,
  projectId,
  busy,
  onApprove,
  onReject,
  onCancel,
}: Props) {
  const StatusIcon = STATUS_ICON[request.status];
  const waitingForAnotherReviewer =
    request.status === 'pending' &&
    request.policy === 'separate-reviewer' &&
    request.canReject &&
    !request.canApprove;

  return (
    <Card className="mt-4 p-5 sm:p-6" role="region" aria-label={t('Production approval')}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">
                {t(REQUEST_TITLE[request.kind])}
              </h3>
              <Badge variant={STATUS_VARIANT[request.status]}>
                <StatusIcon className="h-3 w-3" /> {statusLabel(request.status)}
              </Badge>
            </div>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {t('Requested by {requester} · {date}', {
                requester: person(request.requester),
                date: formatDateTime(request.createdAt),
              })}
            </p>
          </div>
        </div>

        {request.status === 'pending' && (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            {request.canApprove && (
              <Button size="sm" disabled={busy} onClick={onApprove}>
                <CheckCircle2 className="h-4 w-4" /> {t('Approve and deploy')}
              </Button>
            )}
            {request.canReject && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onReject}>
                {t('Reject')}
              </Button>
            )}
            {request.canCancel && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                {t('Cancel request')}
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-3 rounded-lg bg-muted p-4 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="eyebrow">{t('Verified build')}</dt>
          <dd className="mt-0.5 font-mono" title={request.version}>
            {request.version.slice(0, 12)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="eyebrow">{t('Source')}</dt>
          <dd className="mt-0.5 font-medium">{request.sourceEnvironment}</dd>
        </div>
        <div className="min-w-0">
          <dt className="eyebrow">{t('Target')}</dt>
          <dd className="mt-0.5 truncate font-medium" title={request.target.name}>
            {request.target.name}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-3">
          <dt className="eyebrow">{t('Artifact digest')}</dt>
          <dd
            className="mt-0.5 break-all font-mono text-xs"
            title={request.artifact?.digest ?? undefined}
          >
            {request.artifact?.digest ?? t('Not available for this legacy build')}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        {t('Owners, admins and maintainers can review production requests.')}
      </p>
      {waitingForAnotherReviewer && (
        <p className="mt-3 text-xs text-warning">
          {t('A different workspace owner, admin or maintainer must approve this request.')}
        </p>
      )}
      {request.reviewer && (
        <p className="mt-3 text-xs text-muted-foreground">
          {request.reviewedAt
            ? t('Reviewed by {reviewer} · {date}', {
                reviewer: person(request.reviewer),
                date: formatDateTime(request.reviewedAt),
              })
            : t('Reviewed by {reviewer}', { reviewer: person(request.reviewer) })}
        </p>
      )}
      {request.reviewNote && (
        <p
          className={cn(
            'mt-2 text-xs',
            request.status === 'rejected' || request.status === 'failed'
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {request.reviewNote}
        </p>
      )}
      {request.deployment && (
        <Link
          to={`/projects/${projectId}/deployments`}
          className="text-link mt-3 inline-flex items-center gap-1 text-xs font-medium"
        >
          {t('Deployment {status} · {phase}', {
            status: statusLabel(request.deployment.status),
            phase: statusLabel(request.deployment.phase),
          })}
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </Card>
  );
}
