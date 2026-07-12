import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        service: 'platform-api',
        dependencies: { database: 'ok' },
        time: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        dependencies: { database: 'unavailable' },
      });
    }
  }
}
