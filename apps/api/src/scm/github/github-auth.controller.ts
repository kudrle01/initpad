import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { config } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { TOKEN_COOKIE, JwtPayload } from '../../auth/jwt-auth.guard';
import { AuthService } from '../../auth/auth.service';
import { ExternalIdentityService } from '../../identity/external-identity.service';
import { GitHubInstallationService } from './github-installation.service';
import { GitHubUserCredentialService } from './github-user-credential.service';
import {
  GITHUB_OAUTH_NONCE_COOKIE,
  GitHubOAuthService,
  OAuthMode,
} from './github-oauth.service';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// "Sign in with GitHub" and account linking. Both are top-level browser
// redirects, so the session cookie (SameSite=Lax) is available on the callback.
@Controller('auth/github')
export class GitHubAuthController {
  constructor(
    private readonly oauth: GitHubOAuthService,
    private readonly identities: ExternalIdentityService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly installations: GitHubInstallationService,
    private readonly credentials: GitHubUserCredentialService,
  ) {}

  @Get()
  authorize(@Query('mode') modeRaw: string, @Res() res: Response) {
    if (!this.oauth.isConfigured()) return res.redirect(this.frontend('/login?error=github_unavailable'));
    const mode: Exclude<OAuthMode, 'setup'> = modeRaw === 'link' ? 'link' : 'login';
    const { url, nonce } = this.oauth.authorizeUrl(mode);
    res.cookie(GITHUB_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    return res.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!this.oauth.isConfigured()) return res.redirect(this.frontend('/login?error=github_unavailable'));

    const verified = this.oauth.verifyState(state);
    const nonce = (req.cookies as Record<string, string> | undefined)?.[GITHUB_OAUTH_NONCE_COOKIE];
    res.clearCookie(GITHUB_OAUTH_NONCE_COOKIE, { path: '/' });
    if (!verified || !nonce || nonce !== verified.nonce || !code) {
      return res.redirect(
        this.frontend(
          verified?.mode === 'setup'
            ? '/settings?github=installation_error&reason=GitHub%20verification%20expired%20or%20was%20interrupted'
            : '/login?error=github_state',
        ),
      );
    }

    let exchange;
    try {
      exchange = await this.oauth.exchangeCode(code);
    } catch {
      return res.redirect(
        this.frontend(
          verified.mode === 'setup'
            ? '/settings?github=installation_error&reason=Could%20not%20verify%20GitHub%20user'
            : '/login?error=github_exchange',
        ),
      );
    }
    const ghUser = exchange.user;

    if (verified.mode === 'setup') {
      try {
        const installation = await this.installations.completeSetup(
          verified.setupState,
          verified.installationId,
          exchange.token.accessToken,
        );
        return res.redirect(
          this.frontend(
            `/settings?github=installed&account=${encodeURIComponent(installation.accountLogin)}`,
          ),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Could not authorize GitHub installation';
        return res.redirect(
          this.frontend(`/settings?github=installation_error&reason=${encodeURIComponent(reason)}`),
        );
      }
    }

    if (verified.mode === 'link') {
      const userId = await this.sessionUserId(req);
      if (!userId) return res.redirect(this.frontend('/login?next=/settings&error=login_required'));
      try {
        await this.identities.link(userId, 'github', ghUser.providerUserId, ghUser.login);
        await this.credentials.storeExchange(userId, exchange);
        return res.redirect(this.frontend('/settings?github=linked'));
      } catch (e) {
        return res.redirect(this.frontend(`/settings?github=error&reason=${encodeURIComponent((e as Error).message)}`));
      }
    }

    // login mode. An already-linked identity signs in. On the SaaS edition a
    // first-time GitHub user gets an account created from their identity; the
    // self-hosted edition keeps GitHub for linking to an existing account only.
    let user = await this.identities.findUser('github', ghUser.providerUserId);
    if (user && user.active === false) {
      return res.redirect(this.frontend('/login?error=account_deactivated'));
    }
    if (!user) {
      if (config.edition !== 'saas') {
        return res.redirect(this.frontend('/login?error=github_no_account'));
      }
      user = await this.auth.provisionExternalUser({
        provider: 'github',
        providerUserId: ghUser.providerUserId,
        login: ghUser.login,
        email: ghUser.email,
        emailVerified: ghUser.emailVerified,
        name: ghUser.name,
        avatarUrl: ghUser.avatarUrl,
      });
    }
    try {
      await this.credentials.storeExchange(user.id, exchange);
    } catch {
      return res.redirect(this.frontend('/login?error=github_exchange'));
    }
    const { token } = this.auth.createSession(user);
    res.cookie(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res.redirect(this.frontend('/'));
  }

  // Resolves the current session the same way JwtAuthGuard does, but without
  // throwing — the callback degrades to "please sign in" instead.
  private async sessionUserId(req: Request): Promise<string | null> {
    const token = (req.cookies as Record<string, string> | undefined)?.[TOKEN_COOKIE];
    if (!token) return null;
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, active: true, tokenVersion: true },
      });
      if (!user || !user.active || (payload.ver ?? 0) !== user.tokenVersion) return null;
      return user.id;
    } catch {
      return null;
    }
  }

  private frontend(path: string): string {
    return `${config.auth.frontendUrl.replace(/\/+$/, '')}${path}`;
  }
}
