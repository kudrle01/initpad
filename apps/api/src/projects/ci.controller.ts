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

// Webhook volaný z CI (Gitea Actions) po úspěšném buildu. Autentizace sdíleným
// tokenem (Actions secret repa), ne uživatelskou session.
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
    // Nečekáme na build – deploy běží na pozadí.
    void this.projects.deployFromCi(body.repo, body.sha ?? '', body.ref ?? '');
    return { accepted: true };
  }
}
