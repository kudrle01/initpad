import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';
import { stringFields } from '../common/external-payload';

// Workflows already committed to repositories send these fields; they may add
// others, which stay ignored.
const START_FIELDS = { repo: 256, sha: 128, ref: 512 };
const DEPLOY_FIELDS = { ...START_FIELDS, ciStatus: 64, artifactId: 128, artifactDigest: 256 };

// Progress and terminal callbacks called by Gitea/GitHub Actions. They are
// authenticated with a repository-specific token, not a user session.
@Controller('ci')
@PublicEndpoint('ci-token')
export class CiController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('start')
  @HttpCode(202)
  async start(@Headers('authorization') auth: string, @Body() payload: unknown) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing CI token');
    const body = stringFields(payload, START_FIELDS);
    if (!body.repo) return { accepted: false };
    await this.projects.ciStarted(body.repo, body.sha ?? '', body.ref ?? '', token);
    return { accepted: true };
  }

  @Post('deploy')
  @HttpCode(202)
  async deploy(@Headers('authorization') auth: string, @Body() payload: unknown) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing CI token');
    const body = stringFields(payload, DEPLOY_FIELDS);
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
