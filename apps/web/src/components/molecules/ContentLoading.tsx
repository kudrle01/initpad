import { cn } from '@/lib/utils';

type LoadingVariant = 'cards' | 'list' | 'detail';

interface Props {
  label: string;
  variant?: LoadingVariant;
  count?: number;
  className?: string;
}

const BAR = 'rounded-full bg-foreground/[0.07]';

/** Accessible skeletons that preserve a page's shape while its data is loading. */
export function ContentLoading({ label, variant = 'list', count, className }: Props) {
  if (variant === 'detail') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={cn('animate-pulse', className)}
      >
        <span className="sr-only">{label}</span>
        <div className={cn(BAR, 'h-7 w-48 max-w-full')} />
        <div className={cn(BAR, 'mt-3 h-4 w-72 max-w-full')} />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-36 rounded-xl bg-card shadow-sm" />
          ))}
        </div>
        <div className="mt-4 h-40 rounded-xl bg-card shadow-sm" />
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3', className)}
      >
        <span className="sr-only">{label}</span>
        {Array.from({ length: count ?? 6 }).map((_, index) => (
          <div key={index} className="h-44 animate-pulse rounded-xl bg-card shadow-sm" />
        ))}
      </div>
    );
  }

  // List: one card holding placeholder rows, like the real list it stands in for.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'animate-pulse divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count ?? 4 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
          <div className="h-9 w-9 shrink-0 rounded-full bg-foreground/[0.07]" />
          <div className="min-w-0 flex-1">
            <div className={cn(BAR, 'h-3.5 w-40 max-w-[60%]')} />
            <div className={cn(BAR, 'mt-2 h-3 w-64 max-w-[85%]')} />
          </div>
        </div>
      ))}
    </div>
  );
}
