import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentConfig } from './types.js';

export const DEFAULT_CONFIG_PATH = '/var/lib/initpad-agent/agent.json';

async function ensureConfigDirectory(path: string): Promise<string> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`Agent config directory is not a real directory: ${directory}`);
  }
  if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) {
    if (path !== DEFAULT_CONFIG_PATH) {
      throw new Error(
        `Agent config directory permissions are too broad: ${directory} must be mode 0700`,
      );
    }
    await chmod(directory, 0o700);
  }
  return directory;
}

function assertConfig(value: unknown): asserts value is AgentConfig {
  if (!value || typeof value !== 'object') throw new Error('Agent config is invalid');
  const config = value as Record<string, unknown>;
  const hasPreviousCredential = config.previousCredential !== undefined;
  const hasPreviousGeneration = config.previousCredentialGeneration !== undefined;
  if (
    typeof config.controlPlaneUrl !== 'string' ||
    typeof config.agentId !== 'string' ||
    typeof config.targetId !== 'string' ||
    typeof config.credential !== 'string' ||
    !/^initpad_agent_[A-Za-z0-9_-]{43}$/.test(config.credential) ||
    !Number.isInteger(config.credentialGeneration) ||
    Number(config.credentialGeneration) < 1 ||
    hasPreviousCredential !== hasPreviousGeneration ||
    (hasPreviousCredential &&
      (typeof config.previousCredential !== 'string' ||
        !/^initpad_agent_[A-Za-z0-9_-]{43}$/.test(config.previousCredential) ||
        !Number.isInteger(config.previousCredentialGeneration) ||
        Number(config.previousCredentialGeneration) < 1 ||
        Number(config.previousCredentialGeneration) >= Number(config.credentialGeneration))) ||
    config.protocolVersion !== 1 ||
    typeof config.enrolledAt !== 'string'
  ) {
    throw new Error('Agent config is invalid');
  }
}

export async function saveConfig(path: string, config: AgentConfig): Promise<void> {
  assertConfig(config);
  await ensureConfigDirectory(path);

  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * Verifies the credential destination before a single-use enrollment token is
 * redeemed. The probe contains no secret and is always removed.
 */
export async function preflightConfigStorage(path: string): Promise<void> {
  await ensureConfigDirectory(path);
  const probePath = `${path}.probe-${process.pid}-${Date.now()}`;
  try {
    await writeFile(probePath, '', { flag: 'wx', mode: 0o600 });
  } finally {
    await rm(probePath, { force: true });
  }
}

export async function loadConfig(path: string): Promise<AgentConfig> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Agent config is not a regular file: ${path}`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error(`Agent config permissions are too broad: ${path} must be mode 0600`);
  }
  if (
    process.platform !== 'win32' &&
    typeof process.geteuid === 'function' &&
    stat.uid !== process.geteuid()
  ) {
    throw new Error(`Agent config is owned by a different user: ${path}`);
  }
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  assertConfig(value);
  return value;
}

export function normalizeControlPlaneUrl(input: string, allowInsecureHttp = false): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Control-plane URL must be an absolute HTTP(S) URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Control-plane URL must not contain credentials, a query or a fragment');
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '::1' || url.hostname.startsWith('127.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (allowInsecureHttp || loopback))) {
    throw new Error('HTTPS is required; use --allow-insecure-http only for a trusted local test');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}
