import type { DockerCapabilities } from './types.js';
import { dockerError, dockerHttpRequest } from './docker-http.js';
import type { DockerTransport } from './docker-http.js';

type DockerRequester = (path: string, dockerHost: string) => Promise<string>;

interface DockerVersionResponse {
  Version?: unknown;
  ApiVersion?: unknown;
  Os?: unknown;
  Arch?: unknown;
}

interface DockerInfoResponse {
  NCPU?: unknown;
  MemTotal?: unknown;
  SecurityOptions?: unknown;
}

function dockerRequest(transport: DockerTransport = dockerHttpRequest): DockerRequester {
  return async (path, dockerHost) => {
    const response = await transport({ method: 'GET', path, timeoutMs: 5_000 }, dockerHost);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw dockerError(response, path);
    }
    return response.body.toString('utf8');
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 64) {
    throw new Error(`Docker API did not return a valid ${label}`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Docker API did not return a valid ${label}`);
  }
  return Number(value);
}

export async function inspectDocker(
  dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
  requestDocker: DockerRequester = dockerRequest(),
): Promise<DockerCapabilities> {
  const pong = await requestDocker('/_ping', dockerHost);
  if (pong.trim() !== 'OK') throw new Error('Docker daemon ping failed');
  const [versionBody, infoBody] = await Promise.all([
    requestDocker('/version', dockerHost),
    requestDocker('/info', dockerHost),
  ]);
  const version = JSON.parse(versionBody) as DockerVersionResponse;
  const info = JSON.parse(infoBody) as DockerInfoResponse;
  const securityOptions = Array.isArray(info.SecurityOptions)
    ? info.SecurityOptions.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    engineVersion: requiredString(version.Version, 'engine version'),
    apiVersion: requiredString(version.ApiVersion, 'API version'),
    os: requiredString(version.Os, 'operating system'),
    arch: requiredString(version.Arch, 'architecture'),
    rootless: securityOptions.some((option) => option.toLowerCase().includes('rootless')),
    cpus: positiveInteger(info.NCPU, 'CPU count'),
    memoryBytes: positiveInteger(info.MemTotal, 'memory total'),
  };
}
