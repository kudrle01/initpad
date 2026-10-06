import { createElement, Fragment, type ReactNode } from 'react';
import { cs } from './cs';
import { PLURALS, type PluralKey } from './plurals';

/**
 * Localization without a dependency. English is the source language and lives
 * in the code: `t('Save changes')`. Czech is a dictionary keyed by that exact
 * English text, so a call site reads naturally and a missing translation is a
 * type error rather than a blank label.
 */
export type Locale = 'en' | 'cs';
export type MessageKey = keyof typeof cs;
export type { PluralKey };

export const LOCALES: { value: Locale; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'cs', label: 'Čeština', short: 'CZ' },
];

const STORAGE_KEY = 'initpad.locale';
// BCP 47 tags used for dates, numbers and plural rules.
const INTL_TAG: Record<Locale, string> = { en: 'en-GB', cs: 'cs-CZ' };

/**
 * A stored choice wins. Otherwise the first browser language InitPad speaks
 * decides, so an English browser that lists Czech further down stays English.
 */
export function resolveLocale(stored: string | null, preferred: readonly string[]): Locale {
  if (stored === 'en' || stored === 'cs') return stored;
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0];
    if (language === 'en' || language === 'cs') return language;
  }
  return 'en';
}

function detectLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable; fall through to the browser preference.
  }
  return resolveLocale(stored, typeof navigator === 'undefined' ? [] : (navigator.languages ?? []));
}

let locale: Locale = detectLocale();
const listeners = new Set<() => void>();

function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
applyDocumentLanguage();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale) {
  if (next === locale) return;
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this page view.
  }
  applyDocumentLanguage();
  listeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Translates a message. `{name}` placeholders are filled from `vars`. */
export function t(key: MessageKey, vars?: Vars): string {
  return interpolate(locale === 'cs' ? cs[key] : key, vars);
}

/**
 * Marks a message defined outside render (module-level tables) so it is
 * type-checked against the dictionary. Translate it with `t()` where it is shown.
 */
export function msg<K extends MessageKey>(key: K): K {
  return key;
}

/** Count-dependent message; Czech needs three forms where English needs two. */
export function plural(key: PluralKey, count: number, vars?: Vars): string {
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> = PLURALS[key][locale];
  const rule = new Intl.PluralRules(INTL_TAG[locale]).select(count);
  return interpolate(forms[rule] ?? forms.other ?? key, { count, ...vars });
}

type RichValue = ReactNode | ((chunk: ReactNode) => ReactNode);

/**
 * Translates a sentence that contains markup. `{name}` takes any node and
 * `<tag>…</tag>` is rendered by the function passed under the same name, so a
 * translation can reorder the pieces freely:
 *   rich('Type <b>{name}</b> to confirm:', { name, b: (c) => <strong>{c}</strong> })
 */
export function rich(key: MessageKey, values: Record<string, RichValue>): ReactNode {
  return renderRich(locale === 'cs' ? cs[key] : key, values);
}

/** Count-dependent sentence with markup; `{count}` is available to the message. */
export function richPlural(
  key: PluralKey,
  count: number,
  values: Record<string, RichValue> = {},
): ReactNode {
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> = PLURALS[key][locale];
  const rule = new Intl.PluralRules(INTL_TAG[locale]).select(count);
  return renderRich(forms[rule] ?? forms.other ?? key, { count, ...values });
}

function renderRich(template: string, values: Record<string, RichValue>): ReactNode {
  let index = 0;
  const render = (source: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    const pattern = /\{(\w+)\}|<(\w+)>(.*?)<\/\2>/gs;
    let last = 0;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      if (match.index > last) nodes.push(source.slice(last, match.index));
      const [, placeholder, tag, inner] = match;
      const value = values[placeholder ?? tag];
      let node: ReactNode;
      if (placeholder) node = typeof value === 'function' ? value(null) : value;
      else node = typeof value === 'function' ? value(render(inner)) : render(inner);
      nodes.push(createElement(Fragment, { key: index++ }, node));
      last = match.index + match[0].length;
    }
    if (last < source.length) nodes.push(source.slice(last));
    return nodes;
  };
  return createElement(Fragment, null, ...render(template));
}

// ---------------------------------------------------------------- formatting

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Czech dates are spaced ("24. 9. 2026"); keep them from breaking across lines. */
function unbreakableDate(text: string): string {
  return text.replace(/(\d\.) (?=\d)/g, '$1\u00a0');
}

export function formatDateTime(value: string | number | Date): string {
  return unbreakableDate(toDate(value).toLocaleString(INTL_TAG[locale]));
}

export function formatDate(value: string | number | Date): string {
  return unbreakableDate(toDate(value).toLocaleDateString(INTL_TAG[locale]));
}

export function formatTime(value: string | number | Date): string {
  return toDate(value).toLocaleTimeString(INTL_TAG[locale]);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(INTL_TAG[locale], options);
}

/** Compact "5m ago" style age; older than a month falls back to the date. */
export function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{count}m ago', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{count}h ago', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('{count}d ago', { count: days });
  return formatDate(iso);
}
