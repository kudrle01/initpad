import { cn } from '@/lib/utils';

// Atom: colored status dot. The same word means different things in different
// contexts, hence two maps: for environments (deploy) `running` means the app
// is up (green); for a CI job `running` means it is executing right now
// (orange, pulsing) and `pending` means queued (gray).
const DEPLOY_CLASS: Record<string, string> = {
  running: 'bg-success',
  success: 'bg-success',
  deploying: 'bg-warning animate-pulse',
  pending: 'bg-warning',
  queued: 'bg-muted-foreground/40',
  leased: 'bg-warning animate-pulse',
  waiting: 'bg-warning',
  succeeded: 'bg-success',
  cancelled: 'bg-muted-foreground/70',
  failed: 'bg-destructive',
  stopped: 'bg-muted-foreground/70',
  empty: 'bg-muted-foreground/40',
  idle: 'bg-muted-foreground/40',
  online: 'bg-success',
  offline: 'bg-muted-foreground/70',
  disabled: 'bg-destructive',
  'not-enrolled': 'bg-muted-foreground/40',
};

const CI_CLASS: Record<string, string> = {
  success: 'bg-success',
  running: 'bg-warning animate-pulse',
  pending: 'bg-muted-foreground/40',
  failed: 'bg-destructive',
};

export type StatusDotKind = 'deploy' | 'ci';

export function StatusDot({
  status,
  kind = 'deploy',
  className,
}: {
  status: string;
  kind?: StatusDotKind;
  className?: string;
}) {
  const map = kind === 'ci' ? CI_CLASS : DEPLOY_CLASS;
  return (
    <span
      className={cn(
        'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
        map[status] ?? 'bg-muted-foreground/50',
        className,
      )}
    />
  );
}
