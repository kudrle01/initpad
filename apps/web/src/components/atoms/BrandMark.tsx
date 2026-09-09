import type { ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'>;

/**
 * The standalone InitPad symbol. Product name text remains real HTML so it is
 * crisp, selectable and accessible at every size.
 */
export function BrandMark({ className, ...props }: BrandMarkProps) {
  return (
    <img
      src="/brand/initpad-icon-primary.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('block shrink-0 select-none', className)}
      {...props}
    />
  );
}
