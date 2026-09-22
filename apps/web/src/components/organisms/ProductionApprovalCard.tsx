import { Ban, CheckCircle2, Clock3, ExternalLink, ShieldCheck, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProductionDeploymentRequest } from '@/types';

const STATUS_STYLE: Record<ProductionDeploymentRequest['status'], string> = {
  pending: 'border-warning/40 bg-warning/10 text-warning',
  approving: 'border-warning/40 bg-warning/10 text-warning',
  approved: 'border-success/30 bg-success/10 text-success',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
  stale: 'border-border bg-secondary text-muted-foreground',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-secondary text-muted-foreground',
};

const STATUS_ICON = {
  pending: Clock3,
  approving: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  stale: Ban,
  failed: XCircle,
  cancelled: Ban,
} satisfies Record<ProductionDeploymentRequest['status'], typeof Clock3>;

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
    <section
      className="mt-4 rounded-lg border border-border bg-card p-4"
      aria-label="Production approval"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Production {request.kind} request</h3>
              <Badge variant="outline" className={STATUS_STYLE[request.status]}>
                <StatusIcon className="mr-1 h-3 w-3" /> {request.status}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Requested by {person(request.requester)} ·{' '}
              {new Date(request.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {request.status === 'pending' && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {request.canApprove && (
              <Button size="sm" disabled={busy} onClick={onApprove}>
                <CheckCircle2 className="h-4 w-4" /> Approve and deploy
              </Button>
            )}
            {request.canReject && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onReject}>
                Reject
              </Button>
            )}
            {request.canCancel && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                Cancel request
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="mt-4 grid gap-3 rounded-md bg-secondary/50 p-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Verified build</dt>
          <dd className="mt-0.5 font-mono" title={request.version}>
            {request.version.slice(0, 12)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Target</dt>
          <dd className="mt-0.5 truncate font-medium">{request.target.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="mt-0.5 font-medium">{request.sourceEnvironment}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Artifact digest</dt>
          <dd className="mt-0.5 break-all font-mono" title={request.artifact?.digest ?? undefined}>
            {request.artifact?.digest ?? 'Not available for this legacy build'}
          </dd>
        </div>
      </dl>

      {waitingForAnotherReviewer && (
        <p className="mt-3 text-xs text-warning">
          A different workspace owner or admin must approve this request.
        </p>
      )}
      {request.reviewer && (
        <p className="mt-3 text-xs text-muted-foreground">
          Reviewed by {person(request.reviewer)}
          {request.reviewedAt ? ` · ${new Date(request.reviewedAt).toLocaleString()}` : ''}
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
          Deployment {request.deployment.status} · {request.deployment.phase}
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </section>
  );
}
