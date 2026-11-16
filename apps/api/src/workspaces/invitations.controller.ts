import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';
import { RateLimited } from '../auth/rate-limited.decorator';
import { RATE_LIMITS } from '../auth/rate-limit.policy';
import { InvitationTokenDto } from './dto/member.dto';
import { WorkspaceInvitationsService } from './workspace-invitations.service';

/**
 * The invitee side of workspace invitations (ADR-188). The token travels in
 * the request body, never in a URL, so it stays out of access logs.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: WorkspaceInvitationsService) {}

  // Shown before sign-in, so the invitee knows what they are joining.
  @Post('preview')
  @HttpCode(200)
  @PublicEndpoint('invitation-token')
  @RateLimited(RATE_LIMITS.invitationPreview)
  preview(@Body() dto: InvitationTokenDto) {
    return this.invitations.preview(dto.token);
  }

  // Protected by the global session guard: only a signed-in account accepts.
  @Post('accept')
  @HttpCode(200)
  @RateLimited(RATE_LIMITS.invitationAccept)
  accept(@CurrentUser() userId: string, @Body() dto: InvitationTokenDto) {
    return this.invitations.accept(userId, dto.token);
  }
}
