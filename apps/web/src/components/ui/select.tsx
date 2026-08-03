import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Simplified shadcn-style primitive: a styled native <select> (no Radix).
// More than enough for short lists (environment providers) and accessible
// out of the box.
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className={cn('relative inline-flex', className)}>
      <select
        ref={ref}
        className={cn(
          'h-11 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-sm text-foreground sm:h-9',
          'transition-colors hover:bg-secondary/40',
          'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  ),
);
Select.displayName = 'Select';

export { Select };
