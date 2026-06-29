import { Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { DockerProvider } from './providers/docker.provider';
import { SftpProvider } from './providers/sftp.provider';
import { SshProvider } from './providers/ssh.provider';

@Module({
  providers: [DeploymentService, DockerProvider, SftpProvider, SshProvider],
  exports: [DeploymentService],
})
export class DeploymentModule {}
