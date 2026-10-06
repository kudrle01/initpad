import { Badge } from '@/components/ui/badge';
import { StatusDot, type StatusDotKind } from '@/components/atoms/StatusDot';

// Molecule: presentational badge with a status dot + label. Interactive
// contexts wrap it in a semantic link/button owned by the caller.
interface StatusBadgeProps {
  status: string;
  label?: string;
  kind?: StatusDotKind;
  className?: string;
  title?: string;
}

export function StatusBadge({ status, label, kind, className, title }: StatusBadgeProps) {
  return (
    <Badge className={className} title={title}>
      <StatusDot status={status} kind={kind} />
      <span className="truncate">{label ?? status}</span>
    </Badge>
  );
}
