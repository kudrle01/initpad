import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { config } from '../config';
import { AuthService } from './auth.service';
import { JwtAuthGuard, TOKEN_COOKIE } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const STATE_COOKIE = 'oauth_state';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Managed registration — provisions the Gitea account and signs the user in.
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.register(dto);
    this.setSession(res, token);
    return user;
  }

  // Sign-in with a platform-native account.
  @Post('signin')
  async signin(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto);
    this.setSession(res, token);
    return user;
  }

  private setSession(res: Response, token: string) {
    res.cookie(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
    });
  }

  @Get('login')
  login(@Res() res: Response) {
    const state = randomUUID();
    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax' });
    res.redirect(this.auth.authorizeUrl(state));
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) {
      res.redirect(`${config.auth.frontendUrl}/login?error=state`);
      return;
    }
    try {
      const token = await this.auth.handleCallback(code);
      res.clearCookie(STATE_COOKIE);
      res.cookie(TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      res.redirect(config.auth.frontendUrl);
    } catch {
      res.redirect(`${config.auth.frontendUrl}/login?error=oauth`);
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(TOKEN_COOKIE);
    return { ok: true };
  }
}
