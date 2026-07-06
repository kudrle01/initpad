import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
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
    @Headers('x-gitea-event') event: string,
    @Body() body: RepositoryEventDto,
  ) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token !== config.ci.deployToken) {
      throw new UnauthorizedException('Invalid webhook token');
    }
    if (event === 'repository' && body.action === 'deleted' && body.repository?.full_name) {
      // Run in the background — webhook deliveries should return quickly.
      void this.projects.removeByRepo(body.repository.full_name).catch((e) =>
        this.logger.error(`Cleanup after repository deletion failed: ${(e as Error).message}`),
      );
    }
    return { accepted: true };
  }
}
