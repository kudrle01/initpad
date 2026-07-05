import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { AuthModule } from '../auth/auth.module';
import { ScmModule } from '../scm/scm.module';

// AuthModule provides JwtAuthGuard + JwtModule (session cookie verification),
// ScmModule provides GiteaService (personal access token issuance).
// PrismaService is registered globally.
@Module({
  imports: [AuthModule, ScmModule],
  controllers: [MeController],
})
export class MeModule {}
