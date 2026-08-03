import { cn } from '@/lib/utils';

type LoadingVariant = 'cards' | 'list' | 'detail';

interface Props {
  label: string;
  variant?: LoadingVariant;
  count?: number;
  className?: string;
}

/** Accessible skeletons that preserve a page's shape while its data is loading. */
export function ContentLoading({
  label,
  variant = 'list',
  count,
  className,
}: Props) {
  if (variant === 'detail') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={cn('animate-pulse', className)}
      >
        <span className="sr-only">{label}</span>
        <div className="h-6 w-44 max-w-full rounded bg-secondary" />
        <div className="mt-3 h-4 w-64 max-w-full rounded bg-secondary" />
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-32 rounded-lg bg-secondary" />
          ))}
        </div>
        <div className="mt-6 h-4 w-28 rounded bg-secondary" />
        <div className="mt-3 h-16 w-full rounded-lg bg-secondary" />
      </div>
    );
  }

  const items = Array.from({ length: count ?? (variant === 'cards' ? 4 : 3) });
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        variant === 'cards'
          ? 'grid grid-cols-1 gap-4 md:grid-cols-2'
          : 'flex flex-col gap-2',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {items.map((_, index) => (
        <div
          key={index}
          className={cn(
            'animate-pulse rounded-lg border border-border bg-card/60',
            variant === 'cards' ? 'h-40' : 'h-[76px]',
          )}
        />
      ))}
    </div>
  );
}
