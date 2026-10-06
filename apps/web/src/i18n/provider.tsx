import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { getLocale, subscribeLocale, type Locale } from '@/i18n';

/** The active language; re-renders the caller when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * `t()` reads the active language directly, so components do not subscribe to
 * it one by one. Instead the subtree is remounted when the language changes —
 * every label, including ones captured in state, is produced afresh.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return <Fragment key={locale}>{children}</Fragment>;
}
