import * as React from 'react';
import { cn } from '@/lib/utils';

// Shared field chrome for <input>, <select> and <textarea>. 16px text on
// touch-sized fields stops iOS from zooming the page on focus.
export const fieldClassName = cn(
  'w-full min-w-0 rounded-md border border-input bg-card text-base text-foreground shadow-xs sm:text-sm',
  'transition-[border-color,box-shadow] placeholder:text-muted-foreground/80',
  'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/25',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(fieldClassName, 'flex h-11 px-3 py-1 sm:h-9', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
