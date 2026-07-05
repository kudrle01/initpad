import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { TOKEN_COOKIE } from '../auth/jwt-auth.guard';
import { OidcService } from './oidc.service';

// OIDC provider endpoints. The global 'api' prefix applies, so the real
// paths are /api/.well-known/... and /api/oauth/...
@Controller()
export class OidcController {
  private readonly logger = new Logger('OidcController');

  constructor(
    private readonly oidc: OidcService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('.well-known/openid-configuration')
  discovery() {
    return this.oidc.discovery();
  }

  @Get('oauth/jwks')
  jwks() {
    return this.oidc.jwks();
  }

  // Authorization endpoint: verifies the platform session (cookie) and
  // issues an authorization code.
  @Get('oauth/authorize')
  authorize(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    try {
      const { response_type, client_id, redirect_uri, state, nonce } = q;

      if (!this.oidc.isKnownClient(client_id) || !this.oidc.isAllowedRedirect(redirect_uri)) {
        res.status(400).json({ error: 'invalid_client_or_redirect' });
        return;
      }
      if (response_type !== 'code') {
        this.redirectError(res, redirect_uri, state, 'unsupported_response_type');
        return;
      }

      const userId = this.sessionUserId(req);
      if (!userId) {
        // Not signed in on the platform → redirect to login, then back here
        // (browser-facing URL).
        const self = `${config.oidc.publicUrl}/oauth/authorize?${new URLSearchParams(q).toString()}`;
        res.redirect(`${config.auth.frontendUrl}/login?next=${encodeURIComponent(self)}`);
        return;
      }

      const code = this.oidc.issueCode({ userId, clientId: client_id, redirectUri: redirect_uri, nonce });
      const url = new URL(redirect_uri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      res.redirect(url.toString());
    } catch (e) {
      this.logger.error(`authorize failed: ${(e as Error).message}`, (e as Error).stack);
      res.status(500).json({ error: 'server_error', message: (e as Error).message });
    }
  }

  // Token endpoint: exchanges the authorization code for an access_token
  // and a signed id_token.
  @Post('oauth/token')
  async token(@Body() body: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const creds = this.clientCreds(body, req);
    if (!this.oidc.validateClient(creds.id, creds.secret)) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    if (body.grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    const code = this.oidc.consumeCode(body.code);
    if (!code || code.clientId !== creds.id || code.redirectUri !== body.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: code.userId } });
    if (!user) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    const accessToken = this.oidc.issueAccessToken(user.id);
    const idToken = this.oidc.signIdToken({
      sub: user.id,
      aud: creds.id,
      nonce: code.nonce,
      name: user.name ?? user.username,
      preferred_username: user.username,
      email: user.email,
      email_verified: true,
    });
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      scope: 'openid profile email',
    });
  }

  // UserInfo endpoint (authenticated with a Bearer access_token).
  @Get('oauth/userinfo')
  async userinfo(@Req() req: Request, @Res() res: Response) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const userId = this.oidc.userIdForToken(token);
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    res.json({
      sub: user.id,
      name: user.name ?? user.username,
      preferred_username: user.username,
      email: user.email,
      email_verified: true,
    });
  }

  private sessionUserId(req: Request): string | null {
    const token = req.cookies?.[TOKEN_COOKIE];
    if (!token) return null;
    try {
      return this.jwt.verify<{ sub: string }>(token).sub;
    } catch {
      return null;
    }
  }

  private clientCreds(body: Record<string, string>, req: Request): { id: string; secret: string } {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(header.slice(6), 'base64').toString().split(':');
      return { id: id ?? '', secret: secret ?? '' };
    }
    return { id: body.client_id ?? '', secret: body.client_secret ?? '' };
  }

  private redirectError(res: Response, redirectUri: string, state: string, error: string) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (state) url.searchParams.set('state', state);
    res.redirect(url.toString());
  }
}
