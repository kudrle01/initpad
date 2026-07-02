import { Badge, badgeVariants } from '@/components/ui/badge';
import { StatusDot, type StatusDotKind } from '@/components/atoms/StatusDot';
import { cn } from '@/lib/utils';

// Molekula: badge se stavovou tečkou + popiskem. Volitelně jako tlačítko (onClick).
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
    // Ploché tlačítko se vzhledem badge (žádný badge zanořený v buttonu).
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
