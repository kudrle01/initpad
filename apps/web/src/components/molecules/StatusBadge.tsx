import { Badge, badgeVariants } from '@/components/ui/badge';
import { StatusDot, type StatusDotKind } from '@/components/atoms/StatusDot';
import { cn } from '@/lib/utils';

// Molecule: badge with a status dot + label. Optionally rendered as a button
// (when onClick is provided).
interface StatusBadgeProps {
  status: string;
  label?: string;
  kind?: StatusDotKind;
  onClick?: () => void;
  className?: string;
  title?: string;
}

export function StatusBadge({ status, label, kind, onClick, className, title }: StatusBadgeProps) {
  const content = (
    <>
      <StatusDot status={status} kind={kind} />
      {label ?? status}
    </>
  );
  if (onClick) {
    // A flat button styled as a badge (no badge nested inside a button).
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          badgeVariants(),
          'cursor-pointer hover:bg-secondary/70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          className,
        )}
      >
        {content}
      </button>
    );
  }
  return (
    <Badge className={className} title={title}>
      {content}
    </Badge>
  );
}
