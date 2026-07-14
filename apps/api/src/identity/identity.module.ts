import { Module } from '@nestjs/common';
import { ExternalIdentityService } from './external-identity.service';

// External identity linking (GitHub/GitLab). PrismaService is global; the
// GitHub OAuth flow will consume ExternalIdentityService once it lands.
@Module({
  providers: [ExternalIdentityService],
  exports: [ExternalIdentityService],
})
export class IdentityModule {}
