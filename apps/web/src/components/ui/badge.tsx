import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors',
  {
    variants: {
      variant: {
        // Translucent so the chip reads on the canvas and on a card alike.
        default: 'bg-foreground/[0.06] text-muted-foreground',
        outline: 'border-border text-foreground',
        brand: 'bg-secondary text-secondary-foreground',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        danger: 'bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
