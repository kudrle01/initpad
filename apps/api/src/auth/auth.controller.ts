import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard, TOKEN_COOKIE } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { config } from '../config';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Managed registration — provisions the Gitea account and signs the user in.
  @Get('config')
  async authConfig() {
    return {
      registrationAvailable: await this.auth.registrationAvailable(),
      enrollmentRegistrationAvailable: true,
    };
  }

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.register(dto);
    this.setSession(res, token);
    return user;
  }

  // Sign-in with a platform-native account.
  @Post('signin')
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
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @Post('logout')
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
