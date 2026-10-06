import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Always-visible summary line. */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
}

/**
 * Progressive disclosure: secondary detail stays one click away instead of
 * competing with the primary content of a surface.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  className,
  summaryClassName,
  contentClassName,
}: Props) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const contentId = useId();

  function toggle() {
    const next = !open;
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
        className={cn(
          'flex min-h-11 w-full min-w-0 items-center justify-between gap-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 sm:min-h-10',
          summaryClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">{summary}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={contentId} className={contentClassName}>
          {children}
        </div>
      )}
    </div>
  );
}
