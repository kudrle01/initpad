import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import * as tar from 'tar-fs';
import { ProviderKind } from '../../domain/types';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
  TeardownInput,
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

    // Post-deploy verifikace: stejný artefakt může v jednom prostředí naběhnout
    // a v jiném ne (config, síť, závislosti). Proto ověříme, že to TADY odpovídá.
    const url = `http://localhost:${hostPort}`;
    const healthy = await this.waitHealthy(hostPort, input.healthPath ?? '/health');
    if (!healthy) {
      this.logger.warn(`${containerName} nenaběhl zdravě (health check selhal)`);
      return { status: 'failed', url };
    }
    this.logger.log(`Nasazeno a zdravé: ${containerName} → ${url}`);
    return { status: 'running', url };
  }

  // Opakovaně zkouší health endpoint, dokud nevrátí 2xx (nebo nevyprší limit).
  private async waitHealthy(hostPort: string, path: string): Promise<boolean> {
    const target = `http://localhost:${hostPort}${path.startsWith('/') ? '' : '/'}${path}`;
    const attempts = 20; // ~10 s (20 × 500 ms)
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(target);
        if (res.ok) return true;
      } catch {
        // appka ještě nestartuje – zkus znovu
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  // Zastaví a odstraní kontejner i postavený image daného prostředí
  // (bez daemonu no-op).
  async teardown(input: TeardownInput): Promise<void> {
    if (!(await this.isAvailable())) return;
    const containerName = `initpad-${input.projectName}-${input.env}`;
    const image = `initpad/${input.projectName}:${input.env}`;
    await this.removeContainer(containerName);
    await this.removeImage(image);
    this.logger.log(`Odstraněn kontejner ${containerName} i image ${image}`);
  }

  private async removeImage(tag: string): Promise<void> {
    try {
      await this.docker.getImage(tag).remove({ force: true });
    } catch {
      // image už neexistuje / je používán jiným kontejnerem
    }
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
