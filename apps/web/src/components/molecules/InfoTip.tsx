import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function placeInsideViewport() {
      const trigger = rootRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!trigger || !tooltip) return;
      const viewportPadding = 16;
      const gap = 6;
      const preferredLeft = trigger.left + trigger.width / 2 - tooltip.width / 2;
      const maximumLeft = Math.max(viewportPadding, window.innerWidth - tooltip.width - viewportPadding);
      const left = Math.min(Math.max(preferredLeft, viewportPadding), maximumLeft);
      const below = trigger.bottom + gap;
      const above = trigger.top - tooltip.height - gap;
      const preferredTop = below + tooltip.height <= window.innerHeight - viewportPadding
        ? below
        : above;
      const maximumTop = Math.max(viewportPadding, window.innerHeight - tooltip.height - viewportPadding);
      const top = Math.min(Math.max(preferredTop, viewportPadding), maximumTop);
      setPosition({ left, top });
    }

    setPosition(null);
    placeInsideViewport();
    const closeOnScroll = () => setOpen(false);
    window.addEventListener('resize', placeInsideViewport);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      window.removeEventListener('resize', placeInsideViewport);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
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
      // Requiring actual mouse movement avoids a tooltip opening merely
      // because a newly mounted modal appeared underneath a stationary cursor.
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onFocus={(event) => {
          // Radix moves focus into a dialog when it opens. Do not interpret
          // that programmatic entry as a request to open the first InfoTip;
          // keyboard focus moving within the dialog remains supported.
          const dialog = event.currentTarget.closest('[role="dialog"]');
          if (
            dialog &&
            (!event.relatedTarget || !dialog.contains(event.relatedTarget as Node))
          ) return;
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
      >
        <Info className="h-4 w-4" />
      </button>
      {open && createPortal(
        <span
          ref={tooltipRef}
          id={id}
          role="tooltip"
          style={position ? { left: position.left, top: position.top } : undefined}
          className={cn(
            'pointer-events-none fixed z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card px-3 py-2.5 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg transition-opacity',
            position ? 'visible opacity-100' : 'invisible opacity-0',
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
        </span>,
        document.body,
      )}
    </span>
  );
}
