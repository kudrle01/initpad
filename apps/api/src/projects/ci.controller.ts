import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';

interface CiDeployDto {
  repo?: string; // "owner/name"
  sha?: string;
  ref?: string;
  artifactId?: string;
  artifactDigest?: string;
}

// Webhook called from CI (Gitea Actions) after a successful build.
// Authenticated with a repository-specific token, not a user
// session.
@Controller('ci')
export class CiController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('deploy')
  @HttpCode(202)
  async deploy(@Headers('authorization') auth: string, @Body() body: CiDeployDto) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing CI token');
    if (!body.repo) return { accepted: false };
    // Authentication finishes before returning 202; the deployment itself is
    // still scheduled in the background by ProjectsService.
    await this.projects.deployFromCi(body.repo, body.sha ?? '', body.ref ?? '', token, {
      artifactId: body.artifactId,
      artifactDigest: body.artifactDigest,
    });
    return { accepted: true };
  }
}
