import { BadRequestException, Injectable } from '@nestjs/common';
import { ProviderKind } from '../domain/types';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
  ProviderConnection,
  StartInput,
  TeardownInput,
  TeardownResult,
  VerifyResult,
} from './deployment-provider.interface';
import { DockerProvider } from './providers/docker.provider';
import { SftpProvider } from './providers/sftp.provider';
import { SshProvider } from './providers/ssh.provider';

/**
 * Provider registry. Picks the implementation by ProviderKind and delegates
 * the deployment operation to it.
 */
@Injectable()
export class DeploymentService {
  private readonly registry: Map<ProviderKind, DeploymentProvider>;
  private readonly docker: DockerProvider;

  constructor(docker: DockerProvider, sftp: SftpProvider, ssh: SshProvider) {
    this.docker = docker;
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

  async teardown(provider: ProviderKind, input: TeardownInput): Promise<TeardownResult | void> {
    try {
      return await this.registry.get(provider)?.teardown?.(input);
    } finally {
      // SFTP and SSH deployments can also pull/extract the CI image locally.
      // Releasing an environment therefore always releases its exact local
      // image cache entry, independently of where the workload was deployed.
      if (input.imageRef) await this.docker.cleanupImage(input.imageRef);
    }
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

  // Tests a target's reachability/credentials without deploying. `connection`
  // is absent for built-in targets (checked against the local/simulated infra).
  async verify(provider: ProviderKind, connection?: ProviderConnection): Promise<VerifyResult> {
    const impl = this.registry.get(provider);
    if (!impl?.verify) {
      throw new BadRequestException(`Provider '${provider}' does not support connection tests`);
    }
    return impl.verify(connection);
  }

  // Removes local images of the repository (across providers that support it).
  async removeImages(repo: string): Promise<void> {
    for (const impl of this.registry.values()) {
      await impl.removeImages?.(repo);
    }
  }

  // Extracts a directory from a built image into a local dir (Docker only) —
  // used to produce an SFTP-uploadable artifact from a Docker-built app.
  async extractArtifact(imageRef: string, srcPath: string, destDir: string): Promise<void> {
    const impl = this.registry.get('docker');
    if (!impl?.extractArtifact) {
      throw new BadRequestException('Artifact extraction requires the Docker provider');
    }
    await impl.extractArtifact(imageRef, srcPath, destDir);
  }

  async loadImageArchive(filePath: string, expectedRef: string): Promise<void> {
    const impl = this.registry.get('docker');
    if (!impl?.loadImageArchive) {
      throw new BadRequestException('Image archive ingestion requires the Docker provider');
    }
    await impl.loadImageArchive(filePath, expectedRef);
  }

  async saveImageArchive(imageRef: string, destPath: string): Promise<void> {
    const impl = this.registry.get('docker');
    if (!impl?.saveImageArchive) {
      throw new BadRequestException('Image archive export requires the Docker provider');
    }
    await impl.saveImageArchive(imageRef, destPath);
  }

  async hasImage(imageRef: string): Promise<boolean> {
    return (await this.registry.get('docker')?.hasImage?.(imageRef)) ?? false;
  }
}
