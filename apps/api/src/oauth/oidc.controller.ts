import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { readSessionToken } from '../auth/session-cookie';
import { OidcService } from './oidc.service';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';

// OIDC provider endpoints. The global 'api' prefix applies, so the real
// paths are /api/.well-known/... and /api/oauth/...
@Controller()
@PublicEndpoint('oidc-protocol')
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
  async authorize(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const q = singleValues(query, [
        'response_type',
        'client_id',
        'redirect_uri',
        'scope',
        'state',
        'nonce',
      ]);
      if (!q) {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }
      const { response_type, client_id, redirect_uri, state, nonce } = q;

      if (!this.oidc.isKnownClient(client_id) || !this.oidc.isAllowedRedirect(redirect_uri)) {
        res.status(400).json({ error: 'invalid_client_or_redirect' });
        return;
      }
      if (response_type !== 'code') {
        this.redirectError(res, redirect_uri, state, 'unsupported_response_type');
        return;
      }

      const session = await this.sessionUser(req);
      if (!session) {
        // Not signed in on the platform → redirect to login, then back here
        // (browser-facing URL).
        const params = new URLSearchParams(Object.entries(q).filter(([, value]) => value));
        const self = `${config.oidc.publicUrl}/oauth/authorize?${params.toString()}`;
        res.redirect(`${config.auth.frontendUrl}/login?next=${encodeURIComponent(self)}`);
        return;
      }

      const code = await this.oidc.issueCode({
        userId: session.id,
        tokenVersion: session.tokenVersion,
        clientId: client_id,
        redirectUri: redirect_uri,
        nonce: nonce || undefined,
      });
      const url = new URL(redirect_uri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      res.redirect(url.toString());
    } catch (e) {
      // The client and the browser learn only the OAuth error code.
      this.logger.error(`authorize failed: ${(e as Error).message}`, (e as Error).stack);
      res.status(500).json({ error: 'server_error' });
    }
  }

  // Token endpoint: exchanges the authorization code for an access_token
  // and a signed id_token.
  @Post('oauth/token')
  async token(@Body() raw: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const body = singleValues(raw ?? {}, [
      'grant_type',
      'code',
      'redirect_uri',
      'client_id',
      'client_secret',
    ]);
    if (!body) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const creds = this.clientCreds(body, req);
    if (!this.oidc.validateClient(creds.id, creds.secret)) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    if (body.grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    const code = await this.oidc.consumeCode(body.code);
    if (!code || code.clientId !== creds.id || code.redirectUri !== body.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: code.userId } });
    if (
      !user ||
      !user.active ||
      user.mustChangePassword ||
      user.tokenVersion !== code.tokenVersion
    ) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    const accessToken = await this.oidc.issueAccessToken(user.id, user.tokenVersion);
    const idToken = this.oidc.signIdToken({
      sub: user.id,
      aud: creds.id,
      nonce: code.nonce,
      name: user.name ?? user.username,
      preferred_username: user.username,
      email: user.email,
      email_verified: user.emailVerifiedAt != null,
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
    const access = await this.oidc.accessForToken(token);
    if (!access) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: access.userId } });
    if (
      !user ||
      !user.active ||
      user.mustChangePassword ||
      user.tokenVersion !== access.tokenVersion
    ) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    res.json({
      sub: user.id,
      name: user.name ?? user.username,
      preferred_username: user.username,
      email: user.email,
      email_verified: user.emailVerifiedAt != null,
    });
  }

  private async sessionUser(req: Request): Promise<{ id: string; tokenVersion: number } | null> {
    const token = readSessionToken(req);
    if (!token) return null;
    try {
      const payload = this.jwt.verify<{ sub: string; ver?: number }>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, active: true, mustChangePassword: true, tokenVersion: true },
      });
      if (
        !user ||
        !user.active ||
        user.mustChangePassword ||
        (payload.ver ?? 0) !== user.tokenVersion
      ) {
        return null;
      }
      return { id: user.id, tokenVersion: user.tokenVersion };
    } catch {
      return null;
    }
  }

  private clientCreds(
    body: { client_id: string; client_secret: string },
    req: Request,
  ): { id: string; secret: string } {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      // RFC 6749 2.3.1: both parts are form-encoded before Base64, and only
      // the first colon separates them.
      const decoded = Buffer.from(header.slice(6), 'base64').toString();
      const colon = decoded.indexOf(':');
      if (colon < 0) return { id: '', secret: '' };
      try {
        return {
          id: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')),
          secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')),
        };
      } catch {
        return { id: '', secret: '' };
      }
    }
    return { id: body.client_id, secret: body.client_secret };
  }

  private redirectError(res: Response, redirectUri: string, state: string, error: string) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (state) url.searchParams.set('state', state);
    res.redirect(url.toString());
  }
}

/**
 * The named OAuth parameters as plain strings, empty when absent. Repeated or
 * nested parameters (`?code=a&code=b`, `code[x]=1`) are a malformed request,
 * not a value.
 */
function singleValues<K extends string>(
  input: Record<string, unknown>,
  names: readonly K[],
): Record<K, string> | null {
  const values = {} as Record<K, string>;
  for (const name of names) {
    const value = input[name] ?? '';
    if (typeof value !== 'string') return null;
    values[name] = value;
  }
  return values;
}
