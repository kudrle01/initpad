import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from './auth.module';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

describe('AuthModule', () => {
  it('exports the rate-limit guard with its dependency for consuming modules', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule) as unknown[];

    expect(exports).toEqual(expect.arrayContaining([RateLimitService, RateLimitGuard]));
  });
});
