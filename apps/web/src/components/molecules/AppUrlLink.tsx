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
      // The address is the way into the running application, so it is larger
      // and bolder than the surrounding card text and always underlined. The
      // text is truncated with overflow hidden, so the underline offset has to
      // stay small enough to fit inside the line box.
      className={cn(
        'text-link flex min-w-0 items-center gap-1.5 text-sm font-semibold underline underline-offset-2',
        className,
      )}
    >
      <ExternalLink className="h-4 w-4 shrink-0" />
      <span className="truncate">{href.replace(/^https?:\/\//, '')}</span>
    </a>
  );
}
