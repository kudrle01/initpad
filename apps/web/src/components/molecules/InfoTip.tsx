import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InfoTipItem {
  title: string;
  description: ReactNode;
}

interface Props {
  children?: ReactNode;
  items?: InfoTipItem[];
  label?: string;
  className?: string;
}

/**
 * Compact supplementary help. Hover works with a pointer; focus and click
 * make the same content available to keyboard and touch users.
 */
export function InfoTip({ children, items, label = 'More information', className }: Props) {
  const [open, setOpen] = useState(false);
  const [horizontalShift, setHorizontalShift] = useState(0);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function keepInsideViewport() {
      const node = tooltipRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const viewportPadding = 16;
      setHorizontalShift((current) => {
        const baseLeft = rect.left - current;
        const baseRight = rect.right - current;
        if (baseLeft < viewportPadding) return viewportPadding - baseLeft;
        if (baseRight > window.innerWidth - viewportPadding) {
          return window.innerWidth - viewportPadding - baseRight;
        }
        return 0;
      });
    }

    keepInsideViewport();
    window.addEventListener('resize', keepInsideViewport);
    return () => window.removeEventListener('resize', keepInsideViewport);
  }, [open]);

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
        ref={tooltipRef}
        id={id}
        role="tooltip"
        style={{ marginLeft: horizontalShift }}
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-[80] mt-1.5 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2.5 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg transition-opacity',
          open
            ? 'visible opacity-100'
            : 'invisible opacity-0',
        )}
      >
        {items ? (
          <dl className="space-y-2.5">
            {items.map((item) => (
              <div key={item.title}>
                <dt className="font-semibold text-foreground">{item.title}</dt>
                <dd className="mt-0.5 text-muted-foreground">{item.description}</dd>
              </div>
            ))}
          </dl>
        ) : children}
      </span>
    </span>
  );
}
