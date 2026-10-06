import { Fragment, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
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
  const rendered = useRef(locale);

  useEffect(() => {
    if (rendered.current === locale) return;
    rendered.current = locale;
    // The remount discarded the control that switched the language. Focus its
    // replacement (marked `data-language-control`) so keyboard and
    // screen-reader users keep their place instead of restarting at <body>.
    const controls = [...document.querySelectorAll<HTMLElement>('[data-language-control]')];
    (controls.find((control) => control.getClientRects().length > 0) ?? controls[0])?.focus();
  }, [locale]);

  return <Fragment key={locale}>{children}</Fragment>;
}
