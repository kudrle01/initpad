import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard, TOKEN_COOKIE } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ActivateAccountDto, RequestPasswordResetDto, ResetPasswordDto } from './dto/password-reset.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AllowDuringPasswordChange } from './allow-password-change.decorator';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { config } from '../config';
import { PublicEndpoint } from './public-endpoint.decorator';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Managed registration — provisions the Gitea account and signs the user in.
  @Get('config')
  @PublicEndpoint('authentication')
  async authConfig() {
    return {
      registrationAvailable: await this.auth.registrationAvailable(),
      registrationMode: this.auth.registrationMode(),
      edition: config.edition,
      passwordAuthEnabled: config.edition === 'self-hosted',
      // Whether "Sign in with GitHub" / account linking is available.
      githubEnabled: Boolean(
        config.github.clientId && config.github.clientSecret && config.github.callbackUrl,
      ),
    };
  }

  @Post('register')
  @PublicEndpoint('authentication')
  @UseGuards(AuthRateLimitGuard)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.register(dto);
    this.setSession(res, token);
    return user;
  }

  // Sign-in with a platform-native account.
  @Post('signin')
  @PublicEndpoint('authentication')
  @UseGuards(AuthRateLimitGuard)
  async signin(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto);
    this.setSession(res, token);
    return user;
  }

  private setSession(res: Response, token: string) {
    res.cookie(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
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
  @AllowDuringPasswordChange()
  async changePassword(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    this.setSession(res, token);
    return user;
  }

  // Issues an e-mail verification link for the signed-in user's own address.
  @Post('email/request-verification')
  @UseGuards(JwtAuthGuard)
  requestEmailVerification(@CurrentUser() userId: string) {
    return this.auth.requestEmailVerification(userId);
  }

  @Post('email/verify')
  @PublicEndpoint('authentication')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
  }

  // Starts a password reset. Always returns ok so accounts cannot be enumerated.
  @Post('password/request-reset')
  @PublicEndpoint('authentication')
  @UseGuards(AuthRateLimitGuard)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.identity);
    return { ok: true };
  }

  @Post('password/reset')
  @PublicEndpoint('authentication')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    // The reset revokes existing sessions; clear any cookie on this device too.
    res.clearCookie(TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: '/',
    });
  }

  // Activates an admin-provisioned account: the user sets their own password via
  // the link and is signed in immediately.
  @Post('activate')
  @PublicEndpoint('authentication')
  @UseGuards(AuthRateLimitGuard)
  async activate(@Body() dto: ActivateAccountDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.activate(dto.token, dto.newPassword);
    this.setSession(res, token);
    return user;
  }

  @Post('logout')
  @PublicEndpoint('authentication')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(TOKEN_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: '/',
    });
    return { ok: true };
  }
}
