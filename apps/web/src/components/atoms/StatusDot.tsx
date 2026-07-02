import { cn } from '@/lib/utils';

// Atom: barevná tečka stavu. Stejné slovo znamená v každém kontextu něco
// jiného, proto dvě mapy: u prostředí (deploy) je `running` = aplikace běží
// (zelená), u CI jobu je `running` = právě se vykonává (oranžová, pulzuje)
// a `pending` = čeká ve frontě (šedá).
const DEPLOY_CLASS: Record<string, string> = {
  running: 'bg-success',
  success: 'bg-success',
  deploying: 'bg-warning animate-pulse',
  pending: 'bg-warning',
  failed: 'bg-destructive',
  empty: 'bg-muted-foreground/40',
  idle: 'bg-muted-foreground/40',
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
