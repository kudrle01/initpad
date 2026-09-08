import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';

interface CiDeployDto {
  repo?: string; // "owner/name"
  sha?: string;
  ref?: string;
  ciStatus?: string;
  artifactId?: string;
  artifactDigest?: string;
}

interface CiStartDto {
  repo?: string; // "owner/name"
  sha?: string;
  ref?: string;
}

// Progress and terminal callbacks called by Gitea/GitHub Actions. They are
// authenticated with a repository-specific token, not a user session.
@Controller('ci')
@PublicEndpoint('ci-token')
export class CiController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('start')
  @HttpCode(202)
  async start(@Headers('authorization') auth: string, @Body() body: CiStartDto) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing CI token');
    if (!body.repo) return { accepted: false };
    await this.projects.ciStarted(
      body.repo,
      body.sha ?? '',
      body.ref ?? '',
      token,
    );
    return { accepted: true };
  }

  @Post('deploy')
  @HttpCode(202)
  async deploy(@Headers('authorization') auth: string, @Body() body: CiDeployDto) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing CI token');
    if (!body.repo) return { accepted: false };
    // Authentication finishes before returning 202; the deployment itself is
    // still scheduled in the background by ProjectsService.
    await this.projects.deployFromCi(body.repo, body.sha ?? '', body.ref ?? '', token, {
      ciStatus: body.ciStatus,
      artifactId: body.artifactId,
      artifactDigest: body.artifactDigest,
    });
    return { accepted: true };
  }
}
