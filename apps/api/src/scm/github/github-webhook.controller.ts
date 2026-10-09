import {
  BadRequestException,
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
import {
  GitHubInstallationService,
  InstallationEvent,
  InstallationTargetEvent,
} from './github-installation.service';
import { GitHubUserCredentialService } from './github-user-credential.service';
import { GitHubWebhookDeliveryService } from './github-webhook-delivery.service';
import { PublicEndpoint } from '../../auth/public-endpoint.decorator';

// The only events that change state; everything else is acknowledged unread.
const STATEFUL_EVENTS = new Set([
  'installation',
  'installation_target',
  'github_app_authorization',
]);

interface GitHubAuthorizationRevokedEvent {
  action: 'revoked';
  sender: { id: number | string };
}

// Receives GitHub App webhooks (installation and user-authorization lifecycle). GitHub signs the exact
// body with the App's webhook secret (X-Hub-Signature-256). Signature validation
// precedes all state changes, and requests are rejected when no secret is configured.
@Controller('scm/github')
@PublicEndpoint('scm-signature')
export class GitHubWebhookController {
  constructor(
    private readonly installations: GitHubInstallationService,
    private readonly credentials: GitHubUserCredentialService,
    private readonly deliveries: GitHubWebhookDeliveryService,
  ) {}

  @Post('webhook')
  @HttpCode(202)
  async handle(
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
    @Headers('x-github-delivery') delivery: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: InstallationEvent | InstallationTargetEvent | GitHubAuthorizationRevokedEvent,
  ) {
    const secret = config.github.webhookSecret;
    const raw = req.rawBody;
    if (!secret || !raw || !this.verify(signature, raw, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!STATEFUL_EVENTS.has(event)) return { accepted: true };
    if (typeof delivery !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(delivery)) {
      throw new BadRequestException('Missing X-GitHub-Delivery');
    }
    // A replay of an applied delivery is acknowledged without changing state.
    if (await this.deliveries.applied(delivery)) return { accepted: true };
    if (event === 'installation') {
      // Let persistence failures return 5xx so GitHub retries the delivery.
      // A logged-and-accepted failure would permanently lose installation
      // state and make repository access disagree with GitHub.
      await this.installations.handleEvent(body);
    }
    if (event === 'installation_target') {
      // Same retry contract: a lost rename would leave a stale account login.
      await this.installations.handleTargetEvent(body);
    }
    if (event === 'github_app_authorization') {
      const authorization = body as GitHubAuthorizationRevokedEvent;
      if (authorization.action === 'revoked' && authorization.sender?.id != null) {
        // Keep the immutable identity/sign-in binding, but immediately stop
        // performing API calls on behalf of the user who revoked the App.
        await this.credentials.revokeByProviderUserId(String(authorization.sender.id));
      }
    }
    await this.deliveries.record(delivery, event);
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
