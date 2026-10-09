import { BadRequestException } from '@nestjs/common';
import { EnvNamePipe } from './env-name.pipe';

describe('EnvNamePipe', () => {
  it('accepts pipeline environments and rejects anything else', () => {
    const pipe = new EnvNamePipe();
    expect(pipe.transform('prod')).toBe('prod');
    for (const value of ['staging', 'PROD', '', 'prod ', '__proto__']) {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    }
  });
});
