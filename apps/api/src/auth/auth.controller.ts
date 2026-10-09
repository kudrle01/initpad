import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie';
import { CurrentSession, CurrentUser } from './current-user.decorator';
import { SessionsService, type SessionClient } from './sessions.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  ActivateAccountDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/password-reset.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AllowDuringPasswordChange } from './allow-password-change.decorator';
import { config } from '../config';
import { PublicEndpoint } from './public-endpoint.decorator';
import { RateLimited } from './rate-limited.decorator';
import { RATE_LIMITS } from './rate-limit.policy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  // Managed registration — provisions the Gitea account and signs the user in.
  @Get('config')
  @PublicEndpoint('authentication')
  async authConfig() {
    return {
      registrationAvailable: await this.auth.registrationAvailable(),
      registrationMode: this.auth.registrationMode(),
      // The first account must present the installer's setup token.
      bootstrapRequired: await this.auth.bootstrapRequired(),
      edition: config.edition,
      passwordAuthEnabled: config.edition === 'self-hosted',
      emailDeliveryEnabled: this.auth.emailDeliveryEnabled(),
      // Whether "Sign in with GitHub" / account linking is available.
      githubEnabled: Boolean(
        config.github.clientId && config.github.clientSecret && config.github.callbackUrl,
      ),
    };
  }

  @Post('register')
  @PublicEndpoint('authentication')
  @RateLimited(RATE_LIMITS.register)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.register(dto, client(req));
    this.setSession(res, token);
    return user;
  }

  // Sign-in with a platform-native account.
  @Post('signin')
  @PublicEndpoint('authentication')
  @RateLimited(RATE_LIMITS.signIn)
  async signin(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.login(dto, client(req));
    this.setSession(res, token);
    return user;
  }

  private setSession(res: Response, token: string) {
    setSessionCookie(res, token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowDuringPasswordChange()
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  // Change the signed-in user's own password. Reachable during a forced
  // password change; re-issues the session cookie so the caller stays signed in
  // while all other sessions are invalidated.
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @RateLimited(RATE_LIMITS.changePassword)
  @AllowDuringPasswordChange()
  async changePassword(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
      client(req),
    );
    this.setSession(res, token);
    return user;
  }

  // Issues an e-mail verification link for the signed-in user's own address.
  @Post('email/request-verification')
  @UseGuards(JwtAuthGuard)
  @RateLimited(RATE_LIMITS.requestEmailVerification)
  requestEmailVerification(@CurrentUser() userId: string) {
    return this.auth.requestEmailVerification(userId);
  }

  @Post('email/verify')
  @PublicEndpoint('authentication')
  @HttpCode(204)
  @RateLimited(RATE_LIMITS.verifyEmail)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
  }

  // Starts a password reset. Always returns ok so accounts cannot be enumerated.
  @Post('password/request-reset')
  @PublicEndpoint('authentication')
  @RateLimited(RATE_LIMITS.requestPasswordReset)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.identity);
    return { ok: true };
  }

  @Post('password/reset')
  @PublicEndpoint('authentication')
  @HttpCode(204)
  @RateLimited(RATE_LIMITS.resetPassword)
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    // The reset revokes existing sessions; clear any cookie on this device too.
    clearSessionCookie(res);
  }

  // Activates an admin-provisioned account: the user sets their own password via
  // the link and is signed in immediately.
  @Post('activate')
  @PublicEndpoint('authentication')
  @RateLimited(RATE_LIMITS.activate)
  async activate(
    @Body() dto: ActivateAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.activate(dto.token, dto.newPassword, client(req));
    this.setSession(res, token);
    return user;
  }

  // Ends this session on the server too (ADR-147), so a copied cookie stops
  // working before its JWT expires.
  @Post('logout')
  @PublicEndpoint('authentication')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readSessionToken(req);
    if (token) await this.sessions.revokeToken(token);
    clearSessionCookie(res);
    return { ok: true };
  }

  // Signed-in browsers of the account, newest first.
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() userId: string, @CurrentSession() sessionId: string | null) {
    return this.sessions.list(userId, sessionId);
  }

  @Post('sessions/end-others')
  @UseGuards(JwtAuthGuard)
  endOtherSessions(@CurrentUser() userId: string, @CurrentSession() sessionId: string | null) {
    return this.auth.endSessions(userId, { exceptId: sessionId });
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  endSession(
    @CurrentUser() userId: string,
    @CurrentSession() sessionId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (id === sessionId) throw new BadRequestException('Sign out to end the current session');
    return this.auth.endSessions(userId, { id });
  }
}

function client(req: Request): SessionClient {
  return { userAgent: req.headers['user-agent'] };
}
