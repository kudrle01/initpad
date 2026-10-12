import type { Locale } from '@/i18n';

/**
 * Chapters of the user guide (the initpad-docs site). Every language of the
 * guide uses these same anchors, so a link keeps working when the reader
 * switches language there. Renaming one breaks links from released versions.
 */
export type HelpTopic =
  | 'getting-started'
  | 'sign-in'
  | 'github'
  | 'servers'
  | 'new-project'
  | 'import'
  | 'deployments'
  | 'variables'
  | 'team'
  | 'rename-delete'
  | 'troubleshooting'
  | 'limitations';

/** The guide is published per language at <base>/<locale>/ (ADR-156). */
export function helpUrl(base: string, locale: Locale, topic?: HelpTopic): string {
  return `${base.replace(/\/+$/, '')}/${locale}/${topic ? `#${topic}` : ''}`;
}
