import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { AuthModule } from '../auth/auth.module';
import { ScmModule } from '../scm/scm.module';

// AuthModule dodává JwtAuthGuard + JwtModule (ověření session cookie),
// ScmModule dodává GiteaService (vydání PAT). PrismaService je globální.
@Module({
  imports: [AuthModule, ScmModule],
  controllers: [MeController],
})
export class MeModule {}
