import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fieldClassName } from '@/components/ui/input';

// Simplified shadcn-style primitive: a styled native <select> (no Radix).
// More than enough for short lists (environment providers) and accessible
// out of the box.
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        ref={ref}
        className={cn(
          fieldClassName,
          'h-11 cursor-pointer appearance-none truncate pl-3 pr-9 sm:h-9',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  ),
);
Select.displayName = 'Select';

export { Select };
