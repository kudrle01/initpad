import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';
import { AgentDistributionService } from './agent-distribution.service';

@Controller('agent/distribution')
@PublicEndpoint('public-catalog')
export class AgentDistributionController {
  constructor(private readonly distribution: AgentDistributionService) {}

  @Get()
  metadata() {
    return this.distribution.metadata();
  }

  @Get('install.sh')
  async installer(@Res({ passthrough: true }) response: Response) {
    const installer = await this.distribution.installer();
    // Metadata and script must describe the same bytes during a rolling
    // control-plane update; a stale cached script would correctly fail its
    // checksum but make an otherwise valid installation confusing.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(installer, {
      type: 'text/x-shellscript; charset=utf-8',
      length: installer.length,
      disposition: 'attachment; filename="initpad-agent-install.sh"',
    });
  }
}
