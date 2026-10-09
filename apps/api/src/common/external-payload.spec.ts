import { BadRequestException } from '@nestjs/common';
import { stringFields } from './external-payload';

describe('stringFields', () => {
  const limits = { repo: 20, sha: 8 };

  it('reads known string fields and ignores unknown ones', () => {
    expect(stringFields({ repo: 'acme/api', sha: 'abc', extra: { any: 1 } }, limits)).toEqual({
      repo: 'acme/api',
      sha: 'abc',
    });
    expect(stringFields({ repo: null }, limits)).toEqual({});
    expect(stringFields(undefined, limits)).toEqual({});
  });

  it('rejects a known field that is not a bounded string', () => {
    for (const payload of [
      { repo: { not: '' } },
      { repo: ['acme/api'] },
      { sha: 42 },
      { sha: 'x'.repeat(9) },
      ['acme/api'],
      'acme/api',
    ]) {
      expect(() => stringFields(payload, limits)).toThrow(BadRequestException);
    }
  });
});
