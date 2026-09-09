import type { ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src' | 'srcSet'>;

/**
 * The standalone InitPad symbol. Product name text remains real HTML so it is
 * crisp, selectable and accessible at every size.
 */
export function BrandMark({ className, ...props }: BrandMarkProps) {
  return (
    <img
      src="/brand/initpad-icon-128.png"
      srcSet="/brand/initpad-icon-128.png 1x, /brand/initpad-icon-256.png 2x"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('block shrink-0 select-none', className)}
      {...props}
    />
  );
}
