import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ScmModule } from '../scm/scm.module';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

@Module({
  imports: [
    ScmModule,
    JwtModule.register({
      secret: config.auth.jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService, JwtAuthGuard, AuthRateLimitGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard, AuthRateLimitGuard, JwtModule],
})
export class AuthModule {}
