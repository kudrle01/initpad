import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AuthModule } from '../auth/auth.module';
import { ScmModule } from '../scm/scm.module';
import { UpdatesModule } from '../updates/updates.module';

// AuthModule provides JwtAuthGuard + AuthService (managed provisioning);
// ScmModule provides GiteaService. PrismaService is global.
@Module({
  imports: [AuthModule, ScmModule, UpdatesModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
