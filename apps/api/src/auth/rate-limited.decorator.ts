import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { RATE_LIMIT_POLICY, type RateLimitPolicy } from './rate-limit.policy';

export function RateLimited(policy: RateLimitPolicy) {
  return applyDecorators(SetMetadata(RATE_LIMIT_POLICY, policy), UseGuards(RateLimitGuard));
}
