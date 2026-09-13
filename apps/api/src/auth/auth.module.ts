import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ScmModule } from '../scm/scm.module';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

@Module({
  imports: [
    ScmModule,
    JwtModule.register({
      secret: config.auth.jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService, JwtAuthGuard, RateLimitService, RateLimitGuard],
  controllers: [AuthController],
  // Consumers using @RateLimited() resolve the guard in their own module
  // context, so its service dependency must cross the same module boundary.
  exports: [AuthService, JwtAuthGuard, RateLimitService, RateLimitGuard, JwtModule],
})
export class AuthModule {}
