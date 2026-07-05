import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { config } from '../config';
import { ProjectsService } from './projects.service';

interface CiDeployDto {
  repo?: string; // "owner/name"
  sha?: string;
  ref?: string;
}

// Webhook called from CI (Gitea Actions) after a successful build.
// Authenticated with a shared token (the repo's Actions secret), not a user
// session.
@Controller('ci')
export class CiController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('deploy')
  @HttpCode(202)
  async deploy(@Headers('authorization') auth: string, @Body() body: CiDeployDto) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token !== config.ci.deployToken) {
      throw new UnauthorizedException('Invalid CI token');
    }
    if (!body.repo) return { accepted: false };
    // Do not block the CI job — the deployment runs in the background.
    void this.projects.deployFromCi(body.repo, body.sha ?? '', body.ref ?? '');
    return { accepted: true };
  }
}
