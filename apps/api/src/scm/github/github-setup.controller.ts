import {
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { config } from '../../config';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { GitHubAppService } from './github-app.service';
import { GitHubInstallationService } from './github-installation.service';
import { GITHUB_OAUTH_NONCE_COOKIE, GitHubOAuthService } from './github-oauth.service';
import { GitHubUserCredentialService } from './github-user-credential.service';
import { PublicEndpoint } from '../../auth/public-endpoint.decorator';
import { RateLimited } from '../../auth/rate-limited.decorator';
import { RATE_LIMITS } from '../../auth/rate-limit.policy';

/**
 * Holds the raw setup state in the browser that started the setup. GitHub
 * drops `state` when it returns after an existing installation was updated
 * ("Redirect on update"), so the callback falls back to this cookie. It only
 * replaces the query parameter: the state is still verified, bound to its
 * user and workspace, and consumed once.
 */
export const GITHUB_SETUP_STATE_COOKIE = 'initpad_gh_setup';
const SETUP_STATE_COOKIE_PATH = '/api/scm/github/setup';
const SETUP_STATE_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Starts and completes the GitHub App installation handshake (ADR-044). The
 * start is session-authenticated; the callback authenticates itself with a
 * random, hashed, one-time state because GitHub may return in a fresh browser
 * context without relying on the InitPad session cookie.
 */
@Controller('scm/github/setup')
export class GitHubSetupController {
  constructor(
    private readonly installations: GitHubInstallationService,
    private readonly app: GitHubAppService,
    private readonly workspaces: WorkspacesService,
    private readonly oauth: GitHubOAuthService,
    private readonly credentials: GitHubUserCredentialService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @RateLimited(RATE_LIMITS.githubSetup)
  async start(
    @CurrentUser() userId: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-workspace-id') requestedWorkspaceId?: string,
  ) {
    if (!this.app.isConfigured() || !config.github.appSlug) {
      throw new ServiceUnavailableException('GitHub App installation is not configured');
    }
    const workspace = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspace.id, 'admin');
    const state = await this.installations.createSetup(userId, workspace.id);
    res.cookie(GITHUB_SETUP_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookie,
      path: SETUP_STATE_COOKIE_PATH,
      maxAge: SETUP_STATE_LIFETIME_MS,
    });
    const params = new URLSearchParams({ state });
    return {
      installUrl: `${config.github.oauthBaseUrl}/apps/${config.github.appSlug}/installations/new?${params}`,
    };
  }

  @Post('recover')
  @UseGuards(JwtAuthGuard)
  @RateLimited(RATE_LIMITS.githubSetupRecover)
  async recover(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') requestedWorkspaceId?: string,
  ) {
    if (!this.app.isConfigured() || !config.github.appSlug) {
      throw new ServiceUnavailableException('GitHub App installation is not configured');
    }
    const workspace = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspace.id, 'admin');
    const installation =
      (await this.installations.recoverPersonalSetup(userId, workspace.id)) ??
      (await this.installations.recoverRequestedOrganizationSetup(userId, workspace.id, () =>
        this.credentials.accessTokenForUser(userId),
      ));
    return {
      recovered: installation !== null,
      accountLogin: installation?.accountLogin ?? null,
    };
  }

  @Get('callback')
  @PublicEndpoint('authentication')
  @RateLimited(RATE_LIMITS.githubSetupCallback)
  async callback(
    @Query('state') queryState: string,
    @Query('installation_id') installationId: string,
    @Query('setup_action') setupAction: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookieState: unknown = req.cookies?.[GITHUB_SETUP_STATE_COOKIE];
    const state =
      typeof queryState === 'string' && queryState
        ? queryState
        : typeof cookieState === 'string'
          ? cookieState
          : '';
    res.clearCookie(GITHUB_SETUP_STATE_COOKIE, { path: SETUP_STATE_COOKIE_PATH });
    if (setupAction === 'request') {
      // Best effort: without a usable state the request simply stays unclaimed.
      await this.installations.markRequested(state).catch(() => undefined);
      return res.redirect(this.frontend('/settings/workspace?github=installation_requested'));
    }
    try {
      const candidate = await this.installations.inspectSetup(state, installationId);
      if (candidate.accountType === 'Organization') {
        const { url, nonce } = await this.oauth.authorizeSetupUrl(state, installationId);
        res.cookie(GITHUB_OAUTH_NONCE_COOKIE, nonce, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.auth.secureCookie,
          path: '/',
          maxAge: 10 * 60 * 1000,
        });
        return res.redirect(url);
      }
      const installation = await this.installations.completeSetup(state, installationId);
      return res.redirect(
        this.frontend(
          `/settings/workspace?github=installed&account=${encodeURIComponent(installation.accountLogin)}`,
        ),
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Could not authorize GitHub installation';
      return res.redirect(
        this.frontend(
          `/settings/workspace?github=installation_error&reason=${encodeURIComponent(reason)}`,
        ),
      );
    }
  }

  private frontend(path: string): string {
    return `${config.auth.frontendUrl.replace(/\/+$/, '')}${path}`;
  }
}
