import {
  BadRequestException,
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
import { PublicEndpoint } from '../auth/public-endpoint.decorator';
import { stringFields } from '../common/external-payload';

/**
 * Receiver of Gitea system webhooks. The platform registers the hook itself
 * on startup (GiteaService.ensureSystemWebhook) and uses it to reflect
 * out-of-band changes made directly in Gitea — currently repository
 * deletion, which triggers a full cleanup of the corresponding project.
 * Authenticated with the shared platform token, not a user session.
 */
@Controller('scm')
@PublicEndpoint('scm-signature')
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
    @Body() payload: unknown,
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
    const { action } = stringFields(payload, { action: 64 });
    this.logger.log(`SCM webhook received: ${event ?? '?'} / ${action ?? '-'}`);
    if (event === 'repository' && action === 'deleted') {
      const repository = (payload as { repository?: unknown }).repository;
      const { full_name: fullName } = stringFields(repository, { full_name: 256 });
      const id = (repository as { id?: unknown } | undefined)?.id;
      if (!fullName) return { accepted: true };
      if (id != null && typeof id !== 'number' && typeof id !== 'string') {
        throw new BadRequestException('repository.id must be a number or a string');
      }
      // Run in the background — webhook deliveries should return quickly. The
      // project goes only once Gitea confirms the repository is gone.
      void this.projects
        .removeIfRepositoryGone(fullName, 'gitea', id == null ? undefined : String(id))
        .catch((e) =>
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
