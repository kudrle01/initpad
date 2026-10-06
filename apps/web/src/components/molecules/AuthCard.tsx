import type { ReactNode } from 'react';
import { BrandMark } from '@/components/atoms/BrandMark';
import { ThemeToggle } from '@/components/molecules/ThemeToggle';
import { cn } from '@/lib/utils';

/** Shared frame of every signed-out screen: one centered card on the canvas. */
export function AuthCard({
  title,
  description,
  align = 'left',
  children,
}: {
  title: string;
  description?: ReactNode;
  align?: 'left' | 'center';
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-16 sm:p-6">
      <ThemeToggle className="absolute right-3 top-3 sm:right-5 sm:top-5" />
      <main className="w-full max-w-[400px] rounded-2xl border border-border/70 bg-card p-6 shadow-md sm:p-8">
        <div className={cn(align === 'center' && 'text-center')}>
          <BrandMark className={cn('h-11 w-11', align === 'center' && 'mx-auto')} />
          <h1 className="mt-5 break-words text-2xl font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 break-words text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
