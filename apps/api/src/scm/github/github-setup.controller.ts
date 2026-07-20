import {
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { config } from '../../config';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { GitHubAppService } from './github-app.service';
import { GitHubInstallationService } from './github-installation.service';
import { GITHUB_OAUTH_NONCE_COOKIE, GitHubOAuthService } from './github-oauth.service';

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
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async start(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') requestedWorkspaceId?: string,
  ) {
    if (!this.app.isConfigured() || !config.github.appSlug) {
      throw new ServiceUnavailableException('GitHub App installation is not configured');
    }
    const workspace = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspace.id, 'admin');
    const state = await this.installations.createSetup(userId, workspace.id);
    const params = new URLSearchParams({ state });
    return {
      installUrl: `${config.github.oauthBaseUrl}/apps/${config.github.appSlug}/installations/new?${params}`,
    };
  }

  @Post('recover')
  @UseGuards(JwtAuthGuard)
  async recover(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') requestedWorkspaceId?: string,
  ) {
    if (!this.app.isConfigured() || !config.github.appSlug) {
      throw new ServiceUnavailableException('GitHub App installation is not configured');
    }
    const workspace = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspace.id, 'admin');
    const installation = await this.installations.recoverPersonalSetup(userId, workspace.id);
    return {
      recovered: installation !== null,
      accountLogin: installation?.accountLogin ?? null,
    };
  }

  @Get('callback')
  async callback(
    @Query('state') state: string,
    @Query('installation_id') installationId: string,
    @Query('setup_action') setupAction: string,
    @Res() res: Response,
  ) {
    if (setupAction === 'request') {
      return res.redirect(this.frontend('/settings?github=installation_requested'));
    }
    try {
      const candidate = await this.installations.inspectSetup(state, installationId);
      if (candidate.accountType === 'Organization') {
        const { url, nonce } = this.oauth.authorizeSetupUrl(state, installationId);
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

  private frontend(path: string): string {
    return `${config.auth.frontendUrl.replace(/\/+$/, '')}${path}`;
  }
}
