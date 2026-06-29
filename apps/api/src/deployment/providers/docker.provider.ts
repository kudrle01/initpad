import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import * as tar from 'tar-fs';
import { ProviderKind } from '../../domain/types';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
} from '../deployment-provider.interface';

// Postaví image z vygenerovaného Dockerfile a spustí kontejner v síti net-<env>.
// Bez běžícího daemonu degraduje na simulovaný výsledek (vývoj bez Dockeru).
@Injectable()
export class DockerProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'docker';
  private readonly logger = new Logger('DockerProvider');
  private readonly docker = new Docker();

  async deploy(input: DeployInput): Promise<DeployResult> {
    const port = input.port ?? 8080;

    if (!(await this.isAvailable())) {
      this.logger.warn(
        'Docker daemon nedostupný – vracím simulovaný výsledek (spusť Docker pro reálné nasazení)',
      );
      return {
        status: 'running',
        url: `http://${input.projectName}.${input.env}.local`,
      };
    }

    const network = `net-${input.env}`;
    const image = `initpad/${input.projectName}:${input.env}`;
    const containerName = `initpad-${input.projectName}-${input.env}`;

    await this.ensureNetwork(network);
    await this.buildImage(input.repoPath, image);
    await this.removeContainer(containerName);
    const hostPort = await this.runContainer(image, containerName, network, port);

    this.logger.log(`Nasazeno ${containerName} → http://localhost:${hostPort}`);
    return { status: 'running', url: `http://localhost:${hostPort}` };
  }

  private async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureNetwork(name: string): Promise<void> {
    try {
      await this.docker.getNetwork(name).inspect();
    } catch {
      await this.docker.createNetwork({ Name: name });
    }
  }

  private async buildImage(contextDir: string, tag: string): Promise<void> {
    const stream = await this.docker.buildImage(
      tar.pack(contextDir) as unknown as NodeJS.ReadableStream,
      { t: tag },
    );
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  private async removeContainer(name: string): Promise<void> {
    try {
      await this.docker.getContainer(name).remove({ force: true });
    } catch {
      // kontejner zatím neexistuje
    }
  }

  private async runContainer(
    image: string,
    name: string,
    network: string,
    port: number,
  ): Promise<string> {
    const portKey = `${port}/tcp`;
    const container = await this.docker.createContainer({
      Image: image,
      name,
      ExposedPorts: { [portKey]: {} },
      HostConfig: { PublishAllPorts: true, NetworkMode: network },
    });
    await container.start();
    const info = await container.inspect();
    const mapping = info.NetworkSettings.Ports?.[portKey];
    return mapping && mapping[0] ? mapping[0].HostPort : String(port);
  }
}
