import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BrandMarkProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

const MASK = 'url(/brand/initpad-icon-256.png) center / contain no-repeat';
const MASK_STYLE: CSSProperties = { WebkitMask: MASK, mask: MASK };

/**
 * The standalone InitPad symbol. The artwork is used as a mask over the
 * `--primary` token: in the light theme that is exactly the green of the brand
 * files, and on dark surfaces the mark follows the lifted green so it stays
 * legible. Product name text remains real HTML so it is crisp, selectable and
 * accessible at every size.
 */
export function BrandMark({ className, style, ...props }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 select-none bg-primary', className)}
      style={{ ...MASK_STYLE, ...style }}
      {...props}
    />
  );
}
