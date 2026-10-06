import type { HTMLAttributes, LiHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Compact, divided rows. Enumerations (projects, members, events, servers) are
 * rows inside one card — not a tower of separate cards — so a long list stays
 * scannable and each item costs one line of height.
 */
export function List({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn('divide-y divide-border/70', className)} {...props} />;
}

export const listRowClassName = 'flex min-w-0 items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6';

/** Rows that navigate or expand get the same quiet hover and focus treatment. */
export const listRowInteractiveClassName =
  'transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40';

export function ListRow({ className, ...props }: LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cn(listRowClassName, className)} {...props} />;
}
