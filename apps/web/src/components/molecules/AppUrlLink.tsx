import { ExternalLink } from 'lucide-react';
import { cn, externalHref } from '@/lib/utils';

/** Address of a deployed environment; renders nothing unless it is http(s). */
export function AppUrlLink({ url, className }: { url: string | null; className?: string }) {
  const href = externalHref(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className={cn('text-link flex min-w-0 items-center gap-1.5', className)}
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{href.replace(/^https?:\/\//, '')}</span>
    </a>
  );
}
