import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard, TOKEN_COOKIE } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard';
import { InvitationsService } from './invitations.service';
import { RegisterViaInvitationDto } from './dto/accept-invitation.dto';
import { config } from '../config';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Token-addressed invitation flows. Preview and register are public (a
// prospective member is not signed in yet); accept requires a session.
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  @UseGuards(AuthRateLimitGuard)
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  @Post(':token/accept')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  accept(@CurrentUser() userId: string, @Param('token') token: string) {
    return this.invitations.accept(userId, token);
  }

  @Post(':token/register')
  @UseGuards(AuthRateLimitGuard)
  async register(
    @Param('token') token: string,
    @Body() dto: RegisterViaInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token: session, user } = await this.invitations.registerAndAccept(
      token,
      dto.username.trim(),
      dto.password,
    );
    res.cookie(TOKEN_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return user;
  }
}
