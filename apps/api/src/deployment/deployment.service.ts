import { BadRequestException, Injectable } from '@nestjs/common';
import { ProviderKind } from '../domain/types';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
  StartInput,
  TeardownInput,
} from './deployment-provider.interface';
import { DockerProvider } from './providers/docker.provider';
import { SftpProvider } from './providers/sftp.provider';
import { SshProvider } from './providers/ssh.provider';

// Registr providerů – vybere podle ProviderKind a deleguje nasazení.
@Injectable()
export class DeploymentService {
  private readonly registry: Map<ProviderKind, DeploymentProvider>;

  constructor(docker: DockerProvider, sftp: SftpProvider, ssh: SshProvider) {
    this.registry = new Map<ProviderKind, DeploymentProvider>([
      [docker.kind, docker],
      [sftp.kind, sftp],
      [ssh.kind, ssh],
    ]);
  }

  available(): ProviderKind[] {
    return [...this.registry.keys()];
  }

  deploy(provider: ProviderKind, input: DeployInput) {
    const impl = this.registry.get(provider);
    if (!impl) throw new BadRequestException(`Unknown provider '${provider}'`);
    return impl.deploy(input);
  }

  async teardown(provider: ProviderKind, input: TeardownInput): Promise<void> {
    await this.registry.get(provider)?.teardown?.(input);
  }

  async stop(provider: ProviderKind, input: TeardownInput): Promise<void> {
    const impl = this.registry.get(provider);
    if (!impl?.stop) {
      throw new BadRequestException(`Provider '${provider}' does not support stop`);
    }
    await impl.stop(input);
  }

  async start(provider: ProviderKind, input: StartInput): Promise<DeployResult> {
    const impl = this.registry.get(provider);
    if (!impl?.start) {
      throw new BadRequestException(`Provider '${provider}' does not support start`);
    }
    return impl.start(input);
  }

  async logs(provider: ProviderKind, input: TeardownInput): Promise<string> {
    return (await this.registry.get(provider)?.logs?.(input)) ?? '';
  }

  // Úklid lokálních image repa (napříč providery, které to umí – Docker).
  async removeImages(repo: string): Promise<void> {
    for (const impl of this.registry.values()) {
      await impl.removeImages?.(repo);
    }
  }
}
