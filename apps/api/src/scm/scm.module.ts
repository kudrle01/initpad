import { Module } from '@nestjs/common';
import { GiteaService } from './gitea.service';

@Module({
  providers: [GiteaService],
  exports: [GiteaService],
})
export class ScmModule {}
