import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { getLocale, plural, relativeTime, rich, setLocale, t } from '@/i18n';
import { cs } from './cs';
import { statusLabel } from './labels';
import { PLURALS } from './plurals';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (text: string) => [...text.matchAll(/<\/?(\w+)>/g)].map((m) => m[1]).sort();

afterEach(() => setLocale('en'));

describe('Czech dictionary', () => {
  it('keeps every placeholder and markup tag of the English source', () => {
    const broken = Object.entries(cs).filter(
      ([english, czech]) =>
        placeholders(english).join() !== placeholders(czech).join() ||
        tags(english).join() !== tags(czech).join(),
    );
    expect(broken).toEqual([]);
  });

  it('has no empty or untrimmed translation', () => {
    const suspicious = Object.entries(cs).filter(
      ([english, czech]) => !czech || czech !== czech.trim() || english !== english.trim(),
    );
    expect(suspicious).toEqual([]);
  });

  it('gives every plural message a fallback form without unknown placeholders', () => {
    for (const [key, forms] of Object.entries(PLURALS)) {
      const allowed = new Set([...placeholders(key), 'count']);
      for (const language of [forms.en, forms.cs]) {
        expect(language.other, key).toBeTruthy();
        for (const form of Object.values(language)) {
          expect(
            placeholders(form).every((name) => allowed.has(name)),
            `${key} → ${form}`,
          ).toBe(true);
          expect(tags(form).join(), `${key} → ${form}`).toBe(tags(key).join());
        }
      }
    }
  });
});

describe('translation helpers', () => {
  it('returns the English source by default and Czech after switching', () => {
    expect(getLocale()).toBe('en');
    expect(t('Save')).toBe('Save');
    expect(t('Delete server {name}?', { name: 'lab' })).toBe('Delete server lab?');

    setLocale('cs');
    expect(t('Save')).toBe('Uložit');
    expect(t('Delete server {name}?', { name: 'lab' })).toBe('Smazat server lab?');
  });

  it('selects the Czech plural form for one, a few and many', () => {
    expect(plural('{count} projects', 1)).toBe('1 project');
    expect(plural('{count} projects', 5)).toBe('5 projects');

    setLocale('cs');
    expect(plural('{count} projects', 1)).toBe('1 projekt');
    expect(plural('{count} projects', 3)).toBe('3 projekty');
    expect(plural('{count} projects', 5)).toBe('5 projektů');
    expect(plural('{count} projects', 0)).toBe('0 projektů');
  });

  it('renders markup inside a translated sentence, in the translated order', () => {
    const render = () =>
      renderToStaticMarkup(
        createElement(
          'p',
          null,
          rich('Type <b>{projectName}</b> to confirm:', {
            projectName: 'billing-api',
            b: (chunk) => createElement('strong', null, chunk),
          }),
        ),
      );
    expect(render()).toBe('<p>Type <strong>billing-api</strong> to confirm:</p>');

    setLocale('cs');
    expect(render()).toBe('<p>Pro potvrzení napište <strong>billing-api</strong>:</p>');
  });

  it('translates API vocabulary only in Czech and leaves unknown tokens alone', () => {
    expect(statusLabel('running')).toBe('running');
    setLocale('cs');
    expect(statusLabel('running')).toBe('běží');
    expect(statusLabel('some-future-state')).toBe('some-future-state');
  });

  it('formats a recent timestamp as a compact age', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000 - 500).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe('5m ago');
    setLocale('cs');
    expect(relativeTime(fiveMinutesAgo)).toBe('před 5 min');
  });
});
