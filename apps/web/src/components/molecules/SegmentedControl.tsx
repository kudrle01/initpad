import { cn } from '@/lib/utils';

interface Option<T extends string> {
  value: T;
  label: string;
}

/** A short set of mutually exclusive views or filters, shown as one pill track. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  stretch,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
  /** Segments share the full width (forms, narrow dialogs). */
  stretch?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'max-w-full gap-1 overflow-x-auto rounded-full bg-foreground/[0.06] p-1',
        stretch ? 'flex' : 'inline-flex',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors sm:h-8',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              stretch && 'flex-1',
              active
                ? 'bg-card text-foreground shadow-xs dark:bg-foreground/15'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
