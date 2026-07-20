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
  const content = (
    <>
      <StatusDot status={status} kind={kind} />
      {label ?? status}
    </>
  );
  return (
    <Badge className={className} title={title}>
      {content}
    </Badge>
  );
}
