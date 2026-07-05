import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';

// The platform acts as an OIDC identity provider (SSO into Gitea).
// JwtModule is used to verify the platform session cookie.
@Module({
  imports: [
    JwtModule.register({
      secret: config.auth.jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [OidcService],
  controllers: [OidcController],
})
export class OidcModule {}
