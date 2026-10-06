import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Molecule: unified empty/placeholder state (icon, title, description, action).
// `bare` drops the frame when the state already sits inside a card.
export function EmptyState({
  icon: I,
  title,
  description,
  action,
  bare,
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  bare?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-6 text-center',
        bare ? 'py-10' : 'rounded-xl border border-dashed border-input py-14',
        className,
      )}
    >
      {I && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <I className="h-6 w-6" />
        </span>
      )}
      {title && <div className="text-base font-semibold tracking-tight">{title}</div>}
      {description && (
        <p className="max-w-md break-words text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
