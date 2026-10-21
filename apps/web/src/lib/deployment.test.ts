import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import { cleanupNotice } from './deployment';

// The default locale follows the system language, so pin the English source.
beforeEach(() => setLocale('en'));

describe('cleanupNotice', () => {
  it('turns cleanup debt into an actionable, reusable-name notice', () => {
    expect(
      cleanupNotice(
        'Cleanup pending: Public deployment removed. Its canonical path is free for reuse. Delete quarantine as admin.',
      ),
    ).toBe(
      'Public deployment removed; its URL path and project name are free for reuse. Delete quarantine as admin.',
    );
  });

  it('leaves unrelated provider errors unchanged', () => {
    expect(cleanupNotice('Connection refused')).toBe('Connection refused');
  });
});
