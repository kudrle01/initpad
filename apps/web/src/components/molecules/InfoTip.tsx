import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  label?: string;
  className?: string;
}

/**
 * Compact supplementary help. Hover works with a pointer; focus and click
 * make the same content available to keyboard and touch users.
 */
export function InfoTip({ children, label = 'More information', className }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={cn('relative inline-flex shrink-0 align-middle', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <Info className="h-4 w-4" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-[80] mt-1.5 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg transition-opacity',
          open
            ? 'visible opacity-100'
            : 'invisible opacity-0',
        )}
      >
        {children}
      </span>
    </span>
  );
}
