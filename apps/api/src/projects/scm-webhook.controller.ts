import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { ProjectsService } from './projects.service';

interface RepositoryEventDto {
  action?: string;
  repository?: { full_name?: string };
}

/**
 * Receiver of Gitea system webhooks. The platform registers the hook itself
 * on startup (GiteaService.ensureSystemWebhook) and uses it to reflect
 * out-of-band changes made directly in Gitea — currently repository
 * deletion, which triggers a full cleanup of the corresponding project.
 * Authenticated with the shared platform token, not a user session.
 */
@Controller('scm')
export class ScmWebhookController {
  private readonly logger = new Logger('ScmWebhookController');

  constructor(private readonly projects: ProjectsService) {}

  @Post('webhook')
  @HttpCode(202)
  handle(
    @Headers('authorization') auth: string,
    @Headers('x-gitea-signature') signature: string,
    @Headers('x-gitea-event') event: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: RepositoryEventDto,
  ) {
    // Gitea signs the exact request body with the configured webhook secret.
    // Bearer auth remains as a compatibility path, but secrets never enter
    // URLs where proxies and access logs would retain them.
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const raw = req.rawBody;
    const expected = raw
      ? createHmac('sha256', config.scm.webhookToken).update(raw).digest('hex')
      : '';
    const signatureValid = this.safeEqual(signature || '', expected);
    const bearerValid = this.safeEqual(bearer, config.scm.webhookToken);
    if (!signatureValid && !bearerValid) {
      throw new UnauthorizedException('Invalid webhook token');
    }
    this.logger.log(`SCM webhook received: ${event ?? '?'} / ${body.action ?? '-'}`);
    if (event === 'repository' && body.action === 'deleted' && body.repository?.full_name) {
      // Run in the background — webhook deliveries should return quickly.
      void this.projects.removeByRepo(body.repository.full_name).catch((e) =>
        this.logger.error(`Cleanup after repository deletion failed: ${(e as Error).message}`),
      );
    }
    return { accepted: true };
  }

  private safeEqual(actual: string, expected: string): boolean {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }
}
