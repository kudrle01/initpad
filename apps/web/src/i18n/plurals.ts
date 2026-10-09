type Forms = Partial<Record<Intl.LDMLPluralRule, string>>;

/**
 * Messages whose wording depends on a count. The key is the English plural
 * form. English needs `one`/`other`; Czech also needs `few` (2–4) and uses
 * `other` for 0 and 5+ (and `many` for fractions, which falls back to `other`).
 */
export const PLURALS = {
  '{count} sessions signed out': {
    en: { one: '{count} session signed out', other: '{count} sessions signed out' },
    cs: {
      one: 'Odhlášena {count} relace',
      few: 'Odhlášeny {count} relace',
      other: 'Odhlášeno {count} relací',
    },
  },
  '{count} projects': {
    en: { one: '{count} project', other: '{count} projects' },
    cs: { one: '{count} projekt', few: '{count} projekty', other: '{count} projektů' },
  },
  '{count} environments': {
    en: { one: '{count} environment', other: '{count} environments' },
    cs: { one: '{count} prostředí', few: '{count} prostředí', other: '{count} prostředí' },
  },
  '{used} of {count} environments': {
    en: { one: '{used} of {count} environment', other: '{used} of {count} environments' },
    cs: { one: '{used} z {count} prostředí', other: '{used} z {count} prostředí' },
  },
  'Used by {count} environments': {
    en: { one: 'Used by {count} environment', other: 'Used by {count} environments' },
    cs: {
      one: 'Používá {count} prostředí',
      few: 'Používají {count} prostředí',
      other: 'Používá {count} prostředí',
    },
  },
  '{count} server accesses': {
    en: { one: '{count} server access', other: '{count} server accesses' },
    cs: {
      one: '{count} přístup k serveru',
      few: '{count} přístupy k serverům',
      other: '{count} přístupů k serverům',
    },
  },
  '{count} cleanup items': {
    en: { one: '{count} cleanup item', other: '{count} cleanup items' },
    cs: {
      one: '{count} položka k úklidu',
      few: '{count} položky k úklidu',
      other: '{count} položek k úklidu',
    },
  },
  '{count} approvals': {
    en: { one: '{count} approval', other: '{count} approvals' },
    cs: { one: '{count} schválení', other: '{count} schválení' },
  },
  'Source CI builds': {
    en: { one: 'Source CI build', other: 'Source CI builds' },
    cs: { one: 'Zdrojový build z CI', other: 'Zdrojové buildy z CI' },
  },
  '+{count} more': {
    en: { other: '+{count} more' },
    cs: { one: '+{count} další', few: '+{count} další', other: '+{count} dalších' },
  },
  '{names} are hidden because the target capability list does not include <b>{runtime}</b>. <link>Update capabilities</link>.':
    {
      en: {
        one: '{names} is hidden because the target capability list does not include <b>{runtime}</b>. <link>Update capabilities</link>.',
        other:
          '{names} are hidden because the target capability list does not include <b>{runtime}</b>. <link>Update capabilities</link>.',
      },
      cs: {
        one: 'Cíl {names} je skrytý, protože mezi svými runtimy nemá <b>{runtime}</b>. <link>Upravit runtimy</link>.',
        other:
          'Cíle {names} jsou skryté, protože mezi svými runtimy nemají <b>{runtime}</b>. <link>Upravit runtimy</link>.',
      },
    },
  '{names} are not offered because they are marked as unable to run <b>{runtime}</b>.': {
    en: {
      one: '{names} is not offered because it is marked as unable to run <b>{runtime}</b>.',
      other: '{names} are not offered because they are marked as unable to run <b>{runtime}</b>.',
    },
    cs: {
      one: 'Cíl {names} se nenabízí, protože podle nastavení neumí spustit <b>{runtime}</b>.',
      other:
        'Cíle {names} se nenabízejí, protože podle nastavení neumějí spustit <b>{runtime}</b>.',
    },
  },
} satisfies Record<string, { en: Forms; cs: Forms }>;

export type PluralKey = keyof typeof PLURALS;
