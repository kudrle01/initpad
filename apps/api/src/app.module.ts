import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TemplatesModule } from './templates/templates.module';
import { ProjectsModule } from './projects/projects.module';
import { GeneratorModule } from './generator/generator.module';
import { DeploymentModule } from './deployment/deployment.module';
import { TargetsModule } from './targets/targets.module';
import { OidcModule } from './oauth/oidc.module';
import { MeModule } from './me/me.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { CoursesModule } from './courses/courses.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OidcModule,
    TemplatesModule,
    GeneratorModule,
    DeploymentModule,
    TargetsModule,
    ProjectsModule,
    MeModule,
    WorkspacesModule,
    CoursesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
