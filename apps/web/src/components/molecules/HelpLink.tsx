import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '@/auth';
import { getLocale, t } from '@/i18n';
import { helpUrl, type HelpTopic } from '@/lib/help';
import { cn } from '@/lib/utils';

/**
 * Opens a chapter of the user guide in the active language. Renders nothing
 * when the instance links no guide. Signed-out screens pass `base` from the
 * public auth config because they have no user yet.
 */
export function HelpLink({
  topic,
  base,
  className,
  children,
}: {
  topic?: HelpTopic;
  base?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const { user } = useAuth();
  const docsUrl = base === undefined ? user?.docsUrl : base;
  if (!docsUrl) return null;
  return (
    <a
      href={helpUrl(docsUrl, getLocale(), topic)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('text-link inline-flex items-center gap-1 font-medium', className)}
    >
      {children ?? t('Learn more')}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('(opens in a new tab)')}</span>
    </a>
  );
}
