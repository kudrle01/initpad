import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Molekula: jednotný prázdný/placeholder stav (ikona, titulek, popis, akce).
export function EmptyState({
  icon: I,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'flex flex-col items-center gap-3 border-dashed px-6 py-14 text-center shadow-none',
        className,
      )}
    >
      {I && (
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <I className="h-6 w-6" />
        </span>
      )}
      {title && <div className="text-sm font-semibold">{title}</div>}
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </Card>
  );
}
