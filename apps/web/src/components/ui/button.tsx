import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        // Neutral companion to the primary action (Cancel, Refresh, Edit).
        secondary: 'border border-input bg-card text-foreground shadow-xs hover:bg-muted',
        // Tonal green: a recommended next step that must not compete with the
        // single primary action on the page.
        soft: 'bg-secondary text-secondary-foreground hover:bg-primary/15',
        ghost: 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
        destructive:
          'border border-destructive/30 bg-card text-destructive hover:bg-destructive/10',
        // Solid red is reserved for the confirming step of a destructive action.
        danger: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2 sm:h-9',
        sm: 'h-10 px-3 text-[13px] sm:h-8',
        lg: 'h-11 px-6',
        icon: 'h-11 w-11 sm:h-9 sm:w-9',
        'icon-sm': 'h-9 w-9 sm:h-7 sm:w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
