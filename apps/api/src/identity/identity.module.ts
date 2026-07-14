import { Module } from '@nestjs/common';
import { ExternalIdentityService } from './external-identity.service';
import { IdentityController } from './identity.controller';
import { AuthModule } from '../auth/auth.module';

// External identity linking (GitHub/GitLab). AuthModule provides JwtAuthGuard;
// PrismaService is global. The GitHub OAuth flow consumes ExternalIdentityService.
@Module({
  imports: [AuthModule],
  controllers: [IdentityController],
  providers: [ExternalIdentityService],
  exports: [ExternalIdentityService],
})
export class IdentityModule {}
