import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';

// The platform acts as an OIDC identity provider (SSO into Gitea).
// AuthModule verifies the platform session cookie and its session row.
@Module({
  imports: [AuthModule],
  providers: [OidcService],
  controllers: [OidcController],
})
export class OidcModule {}
