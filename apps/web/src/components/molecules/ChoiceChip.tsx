import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Toggleable pill for picking any number of options from a short set. */
export function ChoiceChip({
  selected,
  onToggle,
  children,
  disabled,
}: {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors sm:min-h-8 sm:text-[13px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-primary/50 bg-secondary text-secondary-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
      )}
    >
      {selected && <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />}
      {children}
    </button>
  );
}
