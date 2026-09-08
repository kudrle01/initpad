import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ARTIFACT_STORE, type ArtifactStore } from '../artifacts/artifact-store';
import { PrismaService } from '../prisma/prisma.service';
import { PublicEndpoint } from '../auth/public-endpoint.decorator';

@Controller('health')
@PublicEndpoint('health-check')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARTIFACT_STORE) private readonly artifactStore: ArtifactStore,
  ) {}

  @Get()
  live() {
    return { status: 'ok', service: 'platform-api', time: new Date().toISOString() };
  }

  @Get('live')
  liveness() {
    return this.live();
  }

  @Get('ready')
  async readiness() {
    const [database, artifactStore] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.artifactStore.checkHealth(),
    ]);
    const dependencies = {
      database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
      artifactStore: artifactStore.status === 'fulfilled' ? 'ok' : 'unavailable',
    };
    if (database.status === 'fulfilled' && artifactStore.status === 'fulfilled') {
      return {
        status: 'ready',
        service: 'platform-api',
        dependencies,
        time: new Date().toISOString(),
      };
    }
    throw new ServiceUnavailableException({
      status: 'not-ready',
      service: 'platform-api',
      dependencies,
      time: new Date().toISOString(),
    });
  }
}
