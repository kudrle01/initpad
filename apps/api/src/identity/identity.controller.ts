import { Controller, Delete, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ExternalIdentityService, ScmProviderKind } from './external-identity.service';

// Lets the signed-in user see and remove their linked external accounts.
@Controller('me/identities')
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly identities: ExternalIdentityService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.identities.listForUser(userId);
  }

  @Delete(':provider')
  @HttpCode(204)
  unlink(@CurrentUser() userId: string, @Param('provider') provider: string) {
    const kind: ScmProviderKind = provider === 'gitlab' ? 'gitlab' : 'github';
    return this.identities.unlink(userId, kind);
  }
}
