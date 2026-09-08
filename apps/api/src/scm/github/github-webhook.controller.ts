import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config';
import { GitHubInstallationService, InstallationEvent } from './github-installation.service';
import { GitHubUserCredentialService } from './github-user-credential.service';
import { PublicEndpoint } from '../../auth/public-endpoint.decorator';

interface GitHubAuthorizationRevokedEvent {
  action: 'revoked';
  sender: { id: number | string };
}

// Receives GitHub App webhooks (installation and user-authorization lifecycle). GitHub signs the exact
// body with the App's webhook secret (X-Hub-Signature-256); we verify it before
// touching any state, and refuse everything when no secret is configured.
@Controller('scm/github')
@PublicEndpoint('scm-signature')
export class GitHubWebhookController {
  constructor(
    private readonly installations: GitHubInstallationService,
    private readonly credentials: GitHubUserCredentialService,
  ) {}

  @Post('webhook')
  @HttpCode(202)
  async handle(
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: InstallationEvent | GitHubAuthorizationRevokedEvent,
  ) {
    const secret = config.github.webhookSecret;
    const raw = req.rawBody;
    if (!secret || !raw || !this.verify(signature, raw, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (event === 'installation') {
      // Let persistence failures return 5xx so GitHub retries the delivery.
      // A logged-and-accepted failure would permanently lose installation
      // state and make repository access disagree with GitHub.
      await this.installations.handleEvent(body as InstallationEvent);
    }
    if (event === 'github_app_authorization') {
      const authorization = body as GitHubAuthorizationRevokedEvent;
      if (authorization.action === 'revoked' && authorization.sender?.id != null) {
        // Keep the immutable identity/sign-in binding, but immediately stop
        // performing API calls on behalf of the user who revoked the App.
        await this.credentials.revokeByProviderUserId(String(authorization.sender.id));
      }
    }
    return { accepted: true };
  }

  private verify(signature: string, raw: Buffer, secret: string): boolean {
    if (!signature?.startsWith('sha256=')) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
