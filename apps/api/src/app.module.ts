import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TemplatesModule } from './templates/templates.module';
import { ProjectsModule } from './projects/projects.module';
import { GeneratorModule } from './generator/generator.module';
import { DeploymentModule } from './deployment/deployment.module';

@Module({
  imports: [PrismaModule, TemplatesModule, GeneratorModule, DeploymentModule, ProjectsModule],
  controllers: [HealthController],
})
export class AppModule {}
