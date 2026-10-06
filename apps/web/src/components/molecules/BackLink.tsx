import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** Quiet "up one level" link above a page title. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:mb-3 sm:min-h-0"
    >
      <ArrowLeft className="h-4 w-4" /> {children}
    </Link>
  );
}
