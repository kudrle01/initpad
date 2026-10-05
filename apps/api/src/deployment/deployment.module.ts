import { Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { DockerProvider } from './providers/docker.provider';
import { SftpProvider } from './providers/sftp.provider';

@Module({
  providers: [DeploymentService, DockerProvider, SftpProvider],
  exports: [DeploymentService],
})
export class DeploymentModule {}
