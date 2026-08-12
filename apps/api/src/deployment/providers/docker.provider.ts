import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as tar from 'tar-fs';
import { ProviderKind } from '../../domain/types';
import { config } from '../../config';
import { assertImageArchiveIdentity } from '../../artifacts/image-archive';
import {
  DeployInput,
  DeployResult,
  DeploymentAllocation,
  DeploymentProvider,
  StartInput,
  TeardownInput,
  VerifyResult,
} from '../deployment-provider.interface';

function safeAllocationNamespace(namespace: string): string {
  return namespace
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
}

export function dockerNetworkName(env: string, namespace?: string): string {
  return namespace
    ? `net-${safeAllocationNamespace(namespace)}-${env}`
    : `net-${env}`;
}

export function dockerContainerName(
  projectName: string,
  env: string,
  namespace?: string,
): string {
  return namespace
    ? `initpad-${safeAllocationNamespace(namespace)}-${projectName}-${env}`
    : `initpad-${projectName}-${env}`;
}

/**
 * Container deployment target. Builds an image from the generated Dockerfile
 * (or pulls a pre-built one from the registry) and runs a container attached
 * to the per-environment network (net-<env>).
 */
@Injectable()
export class DockerProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'docker';
  private readonly logger = new Logger('DockerProvider');
  private readonly docker = new Docker();

  // Test connection: the "connection" for Docker is the local daemon.
  async verify(): Promise<VerifyResult> {
    return (await this.isAvailable())
      ? { ok: true, message: 'Docker daemon reachable — containers can be built and run.' }
      : { ok: false, message: 'Docker daemon is not available — start Docker and try again.' };
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const port = input.port ?? 8080;
    input.onProgress?.('Preparing container runtime');

    // No fake "running": without a daemon the deployment honestly fails with
    // a reason (consistent with the SSH/SFTP providers).
    if (!(await this.isAvailable())) {
      this.logger.warn('Docker daemon unavailable — deployment failed');
      return {
        status: 'failed',
        url: '',
        reason: 'Docker daemon is not available — start Docker and redeploy.',
      };
    }

    const network = dockerNetworkName(input.env, input.allocation?.namespace);
    const containerName = dockerContainerName(
      input.projectName,
      input.env,
      input.allocation?.namespace,
    );
    const legacyContainerName = dockerContainerName(input.projectName, input.env);

    await this.ensureNetwork(network);
    // Build once, deploy many: when CI has pushed the image to the registry,
    // pull and run exactly that image (no rebuild).
    let image: string;
    if (input.imageRef) {
      input.onProgress?.('Resolving tested image');
      if (await this.imageExists(input.imageRef)) {
        image = input.imageRef;
        this.logger.log(`Using ingested local image: ${image}`);
      } else if (input.allowBuildFallback) {
        const pull = await this.tryPull(input.imageRef);
        if (pull.ok) {
          image = input.imageRef;
          this.logger.log(`Using registry image: ${image}`);
        } else {
          image = `initpad/${input.projectName}:${input.env}`;
          await this.buildImage(input.repoPath, image);
        }
      } else {
        const pull = await this.tryPull(input.imageRef);
        if (pull.ok) {
          image = input.imageRef;
          this.logger.log(`Using registry image: ${image}`);
        } else {
          // Strict build-once: the tested image is unavailable — do not build
          // a different artifact. Preserve the daemon's real error: "not
          // found", refused HTTP, DNS and authentication require different fixes.
          const reason = `Could not pull tested image ${input.imageRef}: ${pull.error}`;
          this.logger.warn(`${reason} Deployment stopped (build-once).`);
          return { status: 'failed', url: '', reason };
        }
      }
    } else {
      image = `initpad/${input.projectName}:${input.env}`;
      await this.buildImage(input.repoPath, image);
    }
    input.onProgress?.('Replacing previous container');
    await this.removeContainer(containerName);
    if (legacyContainerName !== containerName) {
      // Transition path for environments that were running before ADR-060:
      // their container had no allocation namespace.
      await this.removeContainer(legacyContainerName);
    }
    // Also remove a container left under an older allocation namespace. New
    // containers carry stable project/environment labels, so target changes
    // cannot accumulate hidden instances with obsolete names.
    await this.removeManagedContainers(input.projectName, input.env);
    input.onProgress?.('Starting container');
    const hostPort = await this.runContainer(
      image,
      containerName,
      network,
      port,
      input.projectName,
      input.env,
      input.envVars,
      input.allocation,
    );

    // Post-deploy verification: the same artifact may come up in one
    // environment and fail in another (config, network, dependencies), so the
    // health check runs HERE, against this concrete deployment. The user
    // gets a URL on the public host; the health check may use a different
    // host (deployHealthHost) when the API itself runs in a container.
    const url = `http://${config.publicHost}:${hostPort}`;
    input.onProgress?.('Verifying deployment');
    const healthy = await this.waitHealthy(hostPort, input.healthPath ?? '/health');
    if (!healthy) {
      this.logger.warn(`${containerName} failed its health check`);
      await this.removeContainer(containerName);
      if (input.imageRef) {
        await this.removeImage(input.imageRef);
        await this.pruneUnusedRepositoryImages(input.imageRef);
      }
      return {
        status: 'failed',
        url,
        reason: `Health check at ${input.healthPath ?? '/health'} did not return 2xx within ~10s.`,
      };
    }
    if (input.imageRef) await this.pruneUnusedRepositoryImages(input.imageRef);
    this.logger.log(`Deployed and healthy: ${containerName} → ${url}`);
    return { status: 'running', url };
  }

  // Polls the health endpoint until it returns 2xx or the deadline passes.
  private async waitHealthy(hostPort: string, path: string): Promise<boolean> {
    const target = `http://${config.deployHealthHost}:${hostPort}${path.startsWith('/') ? '' : '/'}${path}`;
    const attempts = 20; // ~10 s (20 × 500 ms)
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(target);
        if (res.ok) return true;
      } catch {
        // App still starting — retry.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  // Stops and removes the environment's container and its locally built image
  // (no-op without a daemon).
  async teardown(input: TeardownInput): Promise<void> {
    if (!(await this.isAvailable())) return;
    const containerName = dockerContainerName(
      input.projectName,
      input.env,
      input.allocation?.namespace,
    );
    const legacyContainerName = dockerContainerName(input.projectName, input.env);
    const image = `initpad/${input.projectName}:${input.env}`;
    await this.removeContainer(containerName);
    if (legacyContainerName !== containerName) await this.removeContainer(legacyContainerName);
    await this.removeManagedContainers(input.projectName, input.env);
    await this.removeImage(image);
    this.logger.log(`Removed container ${containerName} and its unused local images`);
  }

  // Suspends a running container (keeps the image and configuration).
  async stop(input: TeardownInput): Promise<void> {
    if (!(await this.isAvailable())) return;
    const names = [
      dockerContainerName(input.projectName, input.env, input.allocation?.namespace),
      dockerContainerName(input.projectName, input.env),
    ].filter((name, index, all) => all.indexOf(name) === index);
    for (const name of names) {
      const container = this.docker.getContainer(name);
      try {
        await container.inspect();
      } catch {
        continue;
      }
      try {
        await container.stop();
      } catch {
        // Already stopped is still a successful outcome.
      }
      this.logger.log(`Stopped container ${name}`);
      return;
    }
  }

  // Re-starts a stopped container and verifies health (same version).
  async start(input: StartInput): Promise<DeployResult> {
    if (!(await this.isAvailable())) {
      return { status: 'failed', url: '', reason: 'Docker daemon is not available.' };
    }
    const names = [
      dockerContainerName(input.projectName, input.env, input.allocation?.namespace),
      dockerContainerName(input.projectName, input.env),
    ].filter((name, index, all) => all.indexOf(name) === index);
    const port = input.port ?? 8080;
    let name = names[0];
    let container = this.docker.getContainer(name);
    let found = false;
    for (const candidate of names) {
      const current = this.docker.getContainer(candidate);
      try {
        await current.inspect();
        name = candidate;
        container = current;
        found = true;
        break;
      } catch {
        // Try the pre-allocation legacy name next.
      }
    }
    if (!found) {
      return { status: 'failed', url: '', reason: 'Container does not exist.' };
    }
    try {
      await container.start();
    } catch {
      // 304 = already running; any other problem shows up in inspect below.
    }
    let info: Docker.ContainerInspectInfo;
    try {
      info = await container.inspect();
    } catch {
      return {
        status: 'failed',
        url: '',
        reason: 'No container to start — it was removed. Use Redeploy.',
      };
    }
    if (!info.State?.Running) {
      return { status: 'failed', url: '', reason: 'Container could not be started.' };
    }
    const mapping = info.NetworkSettings.Ports?.[`${port}/tcp`];
    const hostPort = mapping && mapping[0] ? mapping[0].HostPort : String(port);
    const url = `http://${config.publicHost}:${hostPort}`;
    const healthy = await this.waitHealthy(hostPort, input.healthPath ?? '/health');
    if (!healthy) {
      return { status: 'failed', url, reason: 'Health check did not pass after start.' };
    }
    this.logger.log(`Started container ${name} → ${url}`);
    return { status: 'running', url };
  }

  // Last ~200 log lines of the environment's container.
  async logs(input: TeardownInput): Promise<string> {
    if (!(await this.isAvailable())) return '';
    const names = [
      dockerContainerName(input.projectName, input.env, input.allocation?.namespace),
      dockerContainerName(input.projectName, input.env),
    ].filter((name, index, all) => all.indexOf(name) === index);
    for (const name of names) {
      try {
        const buf = (await this.docker.getContainer(name).logs({
          stdout: true,
          stderr: true,
          tail: 200,
        })) as unknown as Buffer;
        return this.demuxLogs(buf).trim();
      } catch (e) {
        const msg = (e as Error).message;
        if (/no such container/i.test(msg)) continue;
        return `Logs unavailable: ${msg}`;
      }
    }
    return 'No container running yet — the deployment is in progress or waiting for CI to build the image.';
  }

  // Containers without a TTY return a multiplexed stream (8-byte frame
  // headers); strip the framing to get plain text.
  private demuxLogs(buf: Buffer): string {
    let out = '';
    let i = 0;
    while (i + 8 <= buf.length) {
      const len = buf.readUInt32BE(i + 4);
      out += buf.subarray(i + 8, i + 8 + len).toString('utf8');
      i += 8 + len;
    }
    return out || buf.toString('utf8');
  }

  private async removeImage(tag: string): Promise<void> {
    try {
      // Never force image removal: another environment may run the same tested
      // build. Docker then returns a conflict and the shared image is retained.
      await this.docker.getImage(tag).remove({ force: false });
    } catch {
      // Image already gone or still used by another container.
    }
  }

  async cleanupImage(imageRef: string): Promise<void> {
    if (!(await this.isAvailable())) return;
    await this.removeImage(imageRef);
    await this.pruneUnusedRepositoryImages(imageRef);
  }

  // Removes all locally pulled images of the given registry repository.
  async removeImages(repo: string): Promise<void> {
    if (!(await this.isAvailable())) return;
    try {
      const images = await this.docker.listImages();
      const targets = images.filter((img) =>
        (img.RepoTags ?? []).some((t) => t.startsWith(`${repo}:`)),
      );
      for (const img of targets) {
        await this.docker.getImage(img.Id).remove({ force: true }).catch(() => undefined);
      }
      if (targets.length) this.logger.log(`Removed ${targets.length} image(s) (${repo})`);
    } catch (e) {
      this.logger.warn(`removeImages ${repo} failed: ${(e as Error).message}`);
    }
  }

  // Extracts a directory from a built image into a local dir. Used to turn a
  // Docker-built app (e.g. a Composer-scaffolded PHP framework) into a tree the
  // SFTP provider can upload. Creates (does not start) a container from the
  // image, copies the path out as a tar and unpacks it into destDir.
  async extractArtifact(imageRef: string, srcPath: string, destDir: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('Docker daemon is not available — cannot build the SFTP artifact.');
    }
    if (!(await this.imageExists(imageRef))) {
      const pull = await this.tryPull(imageRef);
      if (!pull.ok) {
        throw new Error(`Could not pull tested image ${imageRef}: ${pull.error}`);
      }
    }
    const container = await this.docker.createContainer({ Image: imageRef, Cmd: ['true'] });
    try {
      const stream = (await container.getArchive({ path: srcPath })) as unknown as NodeJS.ReadableStream;
      await new Promise<void>((resolve, reject) => {
        const extract = tar.extract(destDir);
        extract.on('finish', () => resolve());
        extract.on('error', reject);
        stream.on('error', reject);
        stream.pipe(extract);
      });
      this.logger.log(`Extracted ${srcPath} from ${imageRef}`);
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
      // Static/SFTP deploys need the tested image only while extracting the
      // artifact. Keep the current tag cached, but discard older unused tags
      // from the same project so repeated deployments do not fill the host.
      await this.pruneUnusedRepositoryImages(imageRef);
    }
  }

  async loadImageArchive(filePath: string, expectedRef: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('Docker daemon is not available — cannot ingest the tested image.');
    }
    await assertImageArchiveIdentity(filePath, expectedRef);
    const stream = await this.docker.loadImage(createReadStream(filePath));
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve()));
    });
    if (!(await this.imageExists(expectedRef))) {
      throw new Error(`The ingested image archive did not create expected tag '${expectedRef}'`);
    }
    this.logger.log(`Verified and ingested image archive: ${expectedRef}`);
  }

  async saveImageArchive(imageRef: string, destPath: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('Docker daemon is not available — cannot export the tested image.');
    }
    if (!(await this.imageExists(imageRef))) {
      const pull = await this.tryPull(imageRef);
      if (!pull.ok) throw new Error(`Could not pull tested image ${imageRef}: ${pull.error}`);
    }
    const stream = await this.docker.getImage(imageRef).get();
    await pipeline(stream, createWriteStream(destPath, { mode: 0o600 }));
    await assertImageArchiveIdentity(destPath, imageRef);
    this.logger.log(`Exported verified image archive: ${imageRef}`);
  }

  async hasImage(imageRef: string): Promise<boolean> {
    return (await this.isAvailable()) && this.imageExists(imageRef);
  }

  private async imageExists(ref: string): Promise<boolean> {
    try {
      await this.docker.getImage(ref).inspect();
      return true;
    } catch {
      return false;
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

  // Pulls an image from the registry authenticated as the service account.
  // Returns the daemon's concrete failure instead of collapsing a missing tag,
  // an unreachable registry and rejected HTTP/TLS into the same UI message.
  private async tryPull(ref: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const auth = {
        username: config.registry.user,
        password: config.registry.password,
        serveraddress: config.registry.host,
      };
      const stream = (await this.docker.pull(ref, { authconfig: auth })) as NodeJS.ReadableStream;
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
      });
      return { ok: true };
    } catch (e) {
      const error = (e as Error).message || 'Unknown Docker registry error';
      this.logger.warn(`pull ${ref} failed: ${error}`);
      return { ok: false, error };
    }
  }

  private async removeContainer(name: string): Promise<void> {
    try {
      await this.docker.getContainer(name).remove({ force: true });
    } catch {
      // Container does not exist yet.
    }
  }

  private async removeManagedContainers(projectName: string, env: string): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [
            'com.initpad.managed=true',
            `com.initpad.project=${projectName}`,
            `com.initpad.environment=${env}`,
          ],
        },
      });
      for (const container of containers) {
        await this.docker.getContainer(container.Id).remove({ force: true }).catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn(`Could not remove superseded containers for ${projectName}/${env}: ${(error as Error).message}`);
    }
  }

  // Deletes only local cache tags belonging to the same registry repository
  // and only when no running OR stopped container references their image id.
  // The remote registry/durable artifact history is deliberately preserved for
  // promotion and audit; project deletion has its own full package cleanup.
  private async pruneUnusedRepositoryImages(imageRef: string): Promise<void> {
    const tagSeparator = imageRef.lastIndexOf(':');
    const lastSlash = imageRef.lastIndexOf('/');
    if (tagSeparator <= lastSlash) return;
    const repo = imageRef.slice(0, tagSeparator);
    try {
      const [containers, images] = await Promise.all([
        this.docker.listContainers({ all: true }),
        this.docker.listImages(),
      ]);
      const usedImageIds = new Set(containers.map((container) => container.ImageID));
      let removed = 0;
      for (const image of images) {
        if (usedImageIds.has(image.Id)) continue;
        const staleTags = (image.RepoTags ?? []).filter(
          (tag) => tag.startsWith(`${repo}:`) && tag !== imageRef,
        );
        for (const tag of staleTags) {
          const result = await this.docker.getImage(tag).remove({ force: false }).catch(() => null);
          if (result) removed += 1;
        }
      }
      if (removed > 0) this.logger.log(`Removed ${removed} unused local image tag(s) from ${repo}`);
    } catch (error) {
      // Cleanup is best-effort and must never turn a healthy deployment into a
      // failed one. Disk pressure remains visible through operations/monitoring.
      this.logger.warn(`Could not prune unused images for ${repo}: ${(error as Error).message}`);
    }
  }

  private async runContainer(
    image: string,
    name: string,
    network: string,
    port: number,
    projectName: string,
    environment: string,
    envVars?: Record<string, string>,
    allocation?: DeploymentAllocation,
  ): Promise<string> {
    const portKey = `${port}/tcp`;
    // Application config & secrets (ADR-061), injected into the container's
    // environment. Never logged. Reserved keys are filtered upstream.
    const env = Object.entries(envVars ?? {}).map(([key, value]) => `${key}=${value}`);
    const container = await this.docker.createContainer({
      Image: image,
      name,
      Labels: {
        'com.initpad.managed': 'true',
        'com.initpad.project': projectName,
        'com.initpad.environment': environment,
        ...(allocation
          ? {
              'com.initpad.allocation.id': allocation.id,
              'com.initpad.allocation.namespace': allocation.namespace,
            }
          : {}),
      },
      ...(env.length ? { Env: env } : {}),
      ExposedPorts: { [portKey]: {} },
      HostConfig: {
        NetworkMode: network,
        PortBindings: {
          [portKey]: [{ HostIp: config.deployment.bindAddress, HostPort: '' }],
        },
        Memory: config.deployment.memoryBytes,
        MemorySwap: config.deployment.memoryBytes,
        NanoCpus: config.deployment.nanoCpus,
        PidsLimit: config.deployment.pidsLimit,
        CapDrop: ['ALL'],
        CapAdd: port < 1024 ? ['CHOWN', 'SETGID', 'SETUID', 'NET_BIND_SERVICE'] : [],
        SecurityOpt: ['no-new-privileges'],
        Init: true,
        RestartPolicy: { Name: 'unless-stopped' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
    });
    try {
      await container.start();
      const info = await container.inspect();
      const mapping = info.NetworkSettings.Ports?.[portKey];
      return mapping && mapping[0] ? mapping[0].HostPort : String(port);
    } catch (error) {
      await container.remove({ force: true }).catch(() => undefined);
      throw error;
    }
  }
}
