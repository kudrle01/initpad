import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';

// Platforma jako OIDC provider (SSO). JwtModule slouží k ověření session cookie.
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
