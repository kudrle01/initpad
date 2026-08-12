import http from 'node:http';
import https from 'node:https';
import type { RequestOptions } from 'node:http';
import type { DockerCapabilities } from './types.js';

const DOCKER_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
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

function dockerRequestOptions(path: string, dockerHost: string): {
  client: typeof http | typeof https;
  options: RequestOptions;
} {
  if (dockerHost.startsWith('unix://')) {
    return {
      client: http,
      options: { socketPath: dockerHost.slice('unix://'.length), path, method: 'GET' },
    };
  }
  const endpoint = new URL(dockerHost.replace(/^tcp:/, 'http:'));
  return {
    client: endpoint.protocol === 'https:' ? https : http,
    options: {
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
      path,
      method: 'GET',
    },
  };
}

async function dockerRequest(path: string, dockerHost: string): Promise<string> {
  const { client, options } = dockerRequestOptions(path, dockerHost);
  return new Promise((resolve, reject) => {
    const request = client.request(options, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Docker API response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Docker API returned HTTP ${response.statusCode || 0}`));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(DOCKER_TIMEOUT_MS, () => request.destroy(new Error('Docker API timed out')));
    request.on('error', reject);
    request.end();
  });
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
  requestDocker: DockerRequester = dockerRequest,
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
