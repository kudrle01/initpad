import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { dockerError, dockerHttpRequest } from './docker-http.js';
import type { DockerHttpResponse, DockerTransport } from './docker-http.js';
import { describeFetchFailure } from './network-errors.js';

const IMAGE_REF_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,199}@sha256:[a-f0-9]{64}$/;
const PROJECT_IMAGE_REF_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,254}:[a-z0-9_][a-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HEALTH_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$/;
const MAX_LOG_BYTES = 32 * 1024;
const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;
const DIAGNOSTIC_HEALTH_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const DEFAULT_DIRECT_PORT_RANGE = { first: 30_000, last: 32_767 };
const HOST_PORT_LABEL = 'com.initpad.host-port';
const PORT_CONFLICT = /port is already allocated|address already in use|bind for .* failed/i;
const MAX_PORT_ATTEMPTS = 5;
const SAFE_RUNTIME_CAPABILITIES = [
  'CHOWN',
  'DAC_OVERRIDE',
  'SETGID',
  'SETUID',
  'NET_BIND_SERVICE',
] as const;
const LIFECYCLE_PAYLOAD_FIELDS = new Set([
  'allocationId',
  'namespace',
  'projectSlug',
  'environment',
  'revision',
  'imageRef',
  'containerPort',
  'healthPath',
  'routingMode',
  'cpuLimitMillicores',
  'memoryLimitMb',
  'pidsLimit',
]);
const PROJECT_PAYLOAD_FIELDS = new Set([...LIFECYCLE_PAYLOAD_FIELDS, 'configFingerprint']);
const DIAGNOSTIC_PAYLOAD_FIELDS = new Set([
  'allocationId',
  'namespace',
  'projectSlug',
  'environment',
  'revision',
  'containerPort',
  'healthPath',
  'routingMode',
]);
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const MAX_ENV_VARS = 128;
const MAX_ENV_VALUE_BYTES = 8 * 1024;
const MAX_ENV_TOTAL_BYTES = 128 * 1024;

export interface DockerLifecyclePayload {
  allocationId: string;
  namespace: string;
  projectSlug: string;
  environment: string;
  revision: string;
  imageRef: string;
  containerPort: number;
  healthPath: string;
  routingMode: 'direct-port' | 'managed-gateway';
  configFingerprint?: string;
  cpuLimitMillicores?: number;
  memoryLimitMb?: number;
  pidsLimit?: number;
}

export interface DockerProjectDelivery {
  artifact: {
    path: string;
    sha256: string;
    sizeBytes: number;
  };
  envVars: Record<string, string>;
}

export interface DockerDiagnosticPayload {
  allocationId: string;
  namespace: string;
  projectSlug: string;
  environment: string;
  revision: string;
  containerPort: number;
  healthPath: string;
  routingMode: 'direct-port' | 'managed-gateway';
}

export interface DockerWorkloadStatus {
  state: 'missing' | 'running' | 'stopped';
  revision?: string;
  hostPort?: number;
  workloadSlot?: string;
}

export interface DockerWorkloadDiagnostic extends DockerWorkloadStatus {
  exitCode?: number;
  health: 'healthy' | 'unhealthy' | 'not-running' | 'missing';
  logs: string;
}

export interface DockerLifecycleProgress {
  percent: number;
  stage: 'working' | 'verifying';
  message: string;
}

type ProgressReporter = (progress: DockerLifecycleProgress) => Promise<void>;

interface ContainerInspect {
  Id: string;
  Name?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
  };
  State?: { Running?: boolean; ExitCode?: number };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
}

interface ContainerListItem {
  Id: string;
  Names?: string[];
  Image?: string;
  Labels?: Record<string, string>;
  Ports?: Array<{ PublicPort?: number }>;
}

interface ImageInspect {
  Id?: string;
  RepoDigests?: string[];
}

interface NetworkInspect {
  Containers?: Record<string, unknown>;
  Labels?: Record<string, string>;
}

function requiredSafeString(value: unknown, label: string, pattern = SAFE_ID_PATTERN): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Lifecycle payload contains an invalid ${label}`);
  }
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('Lifecycle payload contains an invalid resource limit');
  }
  return parsed;
}

export function parseLifecyclePayload(value: unknown): DockerLifecyclePayload {
  return parseWorkloadPayload(value, false);
}

export function parseProjectPayload(value: unknown): DockerLifecyclePayload & {
  configFingerprint: string;
} {
  const parsed = parseWorkloadPayload(value, true);
  if (!parsed.configFingerprint) throw new Error('Project payload has no config fingerprint');
  return parsed as DockerLifecyclePayload & { configFingerprint: string };
}

export function parseDiagnosticPayload(value: unknown): DockerDiagnosticPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Diagnostic payload is invalid');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((field) => !DIAGNOSTIC_PAYLOAD_FIELDS.has(field))) {
    throw new Error('Diagnostic payload contains unsupported fields');
  }
  const containerPort = Number(input.containerPort);
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65_535) {
    throw new Error('Diagnostic payload contains an invalid container port');
  }
  return {
    allocationId: requiredSafeString(input.allocationId, 'allocation id'),
    namespace: requiredSafeString(input.namespace, 'namespace', SAFE_NAMESPACE_PATTERN),
    projectSlug: requiredSafeString(input.projectSlug, 'project slug'),
    environment: requiredSafeString(input.environment, 'environment'),
    revision: requiredSafeString(input.revision, 'revision'),
    containerPort,
    healthPath: requiredSafeString(input.healthPath, 'health path', HEALTH_PATH_PATTERN),
    routingMode:
      input.routingMode === 'direct-port' || input.routingMode === 'managed-gateway'
        ? input.routingMode
        : (() => {
            throw new Error('Diagnostic payload contains an invalid routing mode');
          })(),
  };
}

function parseWorkloadPayload(value: unknown, projectDelivery: boolean): DockerLifecyclePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Lifecycle payload is invalid');
  }
  const input = value as Record<string, unknown>;
  const allowed = projectDelivery ? PROJECT_PAYLOAD_FIELDS : LIFECYCLE_PAYLOAD_FIELDS;
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw new Error('Lifecycle payload contains unsupported fields');
  }
  const containerPort = Number(input.containerPort);
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65_535) {
    throw new Error('Lifecycle payload contains an invalid container port');
  }
  const cpuLimitMillicores = boundedInteger(input.cpuLimitMillicores, 100, 64_000, 1_000);
  const memoryLimitMb = boundedInteger(input.memoryLimitMb, 64, 65_536, 512);
  const pidsLimit = boundedInteger(input.pidsLimit, 32, 32_768, 256);
  return {
    allocationId: requiredSafeString(input.allocationId, 'allocation id'),
    namespace: requiredSafeString(input.namespace, 'namespace', SAFE_NAMESPACE_PATTERN),
    projectSlug: requiredSafeString(input.projectSlug, 'project slug'),
    environment: requiredSafeString(input.environment, 'environment'),
    revision: requiredSafeString(input.revision, 'revision'),
    imageRef: requiredSafeString(
      input.imageRef,
      projectDelivery ? 'tested image reference' : 'immutable image reference',
      projectDelivery ? PROJECT_IMAGE_REF_PATTERN : IMAGE_REF_PATTERN,
    ),
    containerPort,
    healthPath: requiredSafeString(input.healthPath, 'health path', HEALTH_PATH_PATTERN),
    routingMode:
      input.routingMode === undefined
        ? 'direct-port'
        : input.routingMode === 'direct-port' || input.routingMode === 'managed-gateway'
          ? input.routingMode
          : (() => {
              throw new Error('Lifecycle payload contains an invalid routing mode');
            })(),
    cpuLimitMillicores,
    memoryLimitMb,
    pidsLimit,
    ...(projectDelivery
      ? {
          configFingerprint: requiredSafeString(
            input.configFingerprint,
            'config fingerprint',
            SHA256_PATTERN,
          ),
        }
      : {}),
  };
}

export function parseProjectDelivery(value: unknown): DockerProjectDelivery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Project delivery material is invalid');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((field) => !['artifact', 'envVars'].includes(field))) {
    throw new Error('Project delivery material contains unsupported fields');
  }
  if (!input.artifact || typeof input.artifact !== 'object' || Array.isArray(input.artifact)) {
    throw new Error('Project artifact delivery is invalid');
  }
  const artifact = input.artifact as Record<string, unknown>;
  if (Object.keys(artifact).some((field) => !['path', 'sha256', 'sizeBytes'].includes(field))) {
    throw new Error('Project artifact delivery contains unsupported fields');
  }
  const sizeBytes = Number(artifact.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 20 * 1024 ** 3) {
    throw new Error('Project artifact size is invalid');
  }
  if (!input.envVars || typeof input.envVars !== 'object' || Array.isArray(input.envVars)) {
    throw new Error('Project environment config is invalid');
  }
  const entries = Object.entries(input.envVars as Record<string, unknown>);
  if (entries.length > MAX_ENV_VARS) throw new Error('Project environment has too many variables');
  const envVars: Record<string, string> = {};
  let totalBytes = 0;
  for (const [key, rawValue] of entries) {
    if (!ENV_KEY_PATTERN.test(key) || key === 'PORT' || typeof rawValue !== 'string') {
      throw new Error('Project environment config contains an invalid variable');
    }
    const bytes = Buffer.byteLength(rawValue);
    if (bytes > MAX_ENV_VALUE_BYTES)
      throw new Error(`Project environment variable '${key}' is too large`);
    totalBytes += Buffer.byteLength(key) + bytes;
    if (totalBytes > MAX_ENV_TOTAL_BYTES)
      throw new Error('Project environment config is too large');
    envVars[key] = rawValue;
  }
  return {
    artifact: {
      path: requiredSafeString(
        artifact.path,
        'artifact path',
        /^\/api\/agent\/jobs\/[A-Za-z0-9_-]+\/artifact$/,
      ),
      sha256: requiredSafeString(artifact.sha256, 'artifact digest', SHA256_PATTERN),
      sizeBytes,
    },
    envVars,
  };
}

function dockerNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function boundedDockerName(value: string): string {
  if (value.length <= 128) return value;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${value.slice(0, 115)}-${digest}`;
}

export function allocationDockerScope(allocationId: string): string {
  return createHash('sha256').update(allocationId).digest('hex').slice(0, 12);
}

export function legacyWorkloadContainerName(
  payload: Pick<DockerLifecyclePayload, 'namespace' | 'projectSlug' | 'environment'>,
): string {
  return boundedDockerName(
    `initpad-${dockerNamePart(payload.namespace)}-${dockerNamePart(payload.projectSlug)}-${dockerNamePart(payload.environment)}`,
  );
}

export function workloadContainerName(
  payload: Pick<
    DockerLifecyclePayload,
    'allocationId' | 'namespace' | 'projectSlug' | 'environment'
  >,
): string {
  return boundedDockerName(
    `initpad-${dockerNamePart(payload.namespace)}-a${allocationDockerScope(payload.allocationId)}-${dockerNamePart(payload.projectSlug)}-${dockerNamePart(payload.environment)}`,
  );
}

export function managedWorkloadContainerName(
  payload: Pick<
    DockerLifecyclePayload,
    'allocationId' | 'namespace' | 'projectSlug' | 'environment'
  >,
  slot: string,
): string {
  if (!/^[a-f0-9]{12}$/.test(slot)) throw new Error('Managed workload slot is invalid');
  return boundedDockerName(`${workloadContainerName(payload)}-rev-${slot}`);
}

export function legacyManagedWorkloadContainerName(
  payload: Pick<DockerLifecyclePayload, 'namespace' | 'projectSlug' | 'environment'>,
  slot: string,
): string {
  if (!/^[a-f0-9]{12}$/.test(slot)) throw new Error('Managed workload slot is invalid');
  return boundedDockerName(`${legacyWorkloadContainerName(payload)}-rev-${slot}`);
}

export function managedWorkloadSlot(
  payload: Pick<DockerLifecyclePayload, 'revision' | 'imageRef' | 'configFingerprint'>,
): string {
  return createHash('sha256')
    .update(`${payload.revision}\0${payload.imageRef}\0${payload.configFingerprint ?? ''}`)
    .digest('hex')
    .slice(0, 12);
}

export function workloadNetworkName(
  payload: Pick<
    DockerLifecyclePayload,
    'allocationId' | 'namespace' | 'projectSlug' | 'environment' | 'routingMode'
  >,
): string {
  const scope = `a${allocationDockerScope(payload.allocationId)}`;
  const suffix =
    payload.routingMode === 'managed-gateway'
      ? `${dockerNamePart(payload.namespace)}-${scope}-${dockerNamePart(payload.projectSlug)}-${dockerNamePart(payload.environment)}`
      : `${dockerNamePart(payload.namespace)}-${scope}-${dockerNamePart(payload.environment)}`;
  return boundedDockerName(`net-${suffix}`);
}

export function legacyWorkloadNetworkName(
  payload: Pick<
    DockerLifecyclePayload,
    'namespace' | 'projectSlug' | 'environment' | 'routingMode'
  >,
): string {
  const suffix =
    payload.routingMode === 'managed-gateway'
      ? `${dockerNamePart(payload.namespace)}-${dockerNamePart(payload.projectSlug)}-${dockerNamePart(payload.environment)}`
      : `${dockerNamePart(payload.namespace)}-${dockerNamePart(payload.environment)}`;
  return boundedDockerName(`net-${suffix}`);
}

function publishedHost(dockerHost: string): string {
  const configured = process.env.INITPAD_AGENT_PUBLISHED_HOST?.trim();
  if (configured) return configured;
  if (!dockerHost.startsWith('unix://')) {
    return new URL(dockerHost.replace(/^tcp:/, 'http:')).hostname;
  }
  return '127.0.0.1';
}

/** Candidate health budget, measured from the first probe (env, seconds). */
export function healthTimeoutFromEnv(
  value = process.env.INITPAD_AGENT_HEALTH_TIMEOUT_SECONDS,
): number {
  const seconds = Number(value?.trim() || NaN);
  if (!Number.isFinite(seconds)) return DEFAULT_HEALTH_TIMEOUT_MS;
  return Math.round(Math.min(600, Math.max(5, seconds)) * 1_000);
}

/** Host port range for direct-port workloads, e.g. `30000-32767`. */
export function directPortRangeFromEnv(value = process.env.INITPAD_AGENT_DIRECT_PORT_RANGE): {
  first: number;
  last: number;
} {
  const match = /^\s*(\d{1,5})\s*-\s*(\d{1,5})\s*$/.exec(value ?? '');
  if (!match) return DEFAULT_DIRECT_PORT_RANGE;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (first < 1024 || last > 65_535 || last < first) return DEFAULT_DIRECT_PORT_RANGE;
  return { first, last };
}

interface HealthProbe {
  ok: boolean;
  url?: string;
  detail: string;
}

function responseJson<T>(response: DockerHttpResponse, action: string): T {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw dockerError(response, action);
  }
  try {
    return JSON.parse(response.body.toString('utf8')) as T;
  } catch {
    throw new Error(`Docker API ${action} returned invalid JSON`);
  }
}

function demuxLogs(body: Buffer): string {
  let output = '';
  let offset = 0;
  while (offset + 8 <= body.length) {
    const length = body.readUInt32BE(offset + 4);
    if (offset + 8 + length > body.length) break;
    output += body.subarray(offset + 8, offset + 8 + length).toString('utf8');
    offset += 8 + length;
  }
  // Keep terminal control sequences out of the persisted/browser-rendered
  // snapshot. Newlines, carriage returns and tabs remain useful log content;
  // ANSI CSI/OSC and other C0 controls are display state, not application text.
  const escape = String.fromCodePoint(27);
  const bell = String.fromCodePoint(7);
  const ansiOsc = new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, 'g');
  const ansiCsi = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const printable = (output || body.toString('utf8'))
    .replace(ansiOsc, '')
    .replace(ansiCsi, '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('');
  return printable.trim().slice(-MAX_LOG_BYTES);
}

/**
 * Explicit Docker allow-list used by Agent jobs. It never exposes exec, build,
 * bind mounts, privileged mode, host networking or caller-defined commands.
 */
export class DockerLifecycle {
  private readonly host: string;

  constructor(
    private readonly targetId: string,
    private readonly dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    private readonly transport: DockerTransport = dockerHttpRequest,
    host?: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly healthTimeoutMs = healthTimeoutFromEnv(),
    private readonly directPortRange = directPortRangeFromEnv(),
  ) {
    this.host = host ?? publishedHost(dockerHost);
  }

  async acceptance(
    rawPayload: unknown,
    jobId: string,
    signal: AbortSignal,
    report: ProgressReporter,
  ): Promise<void> {
    const original = parseLifecyclePayload(rawPayload);
    const promoted = { ...original, revision: `${original.revision}-next` };
    let imageWasPresent = false;
    try {
      await report({ percent: 8, stage: 'working', message: 'Pulling immutable diagnostic image' });
      imageWasPresent = await this.imageMatches(original.imageRef, signal);
      await this.pullImage(original.imageRef, signal);
      await report({
        percent: 24,
        stage: 'working',
        message: 'Creating isolated diagnostic workload',
      });
      await this.deploy(original, jobId, signal);
      await report({
        percent: 40,
        stage: 'verifying',
        message: 'Verifying health and bounded logs',
      });
      if (!(await this.healthy(original, signal)))
        throw new Error('Diagnostic workload is unhealthy');
      await this.logs(original, signal);
      await report({ percent: 52, stage: 'working', message: 'Replacing workload idempotently' });
      await this.deploy(promoted, jobId, signal);
      await report({
        percent: 64,
        stage: 'working',
        message: 'Rolling back to the previous revision',
      });
      await this.rollback(original, jobId, signal);
      await report({ percent: 76, stage: 'working', message: 'Stopping and restarting workload' });
      await this.stop(original, signal);
      const stopped = await this.status(original, signal);
      if (stopped.state !== 'stopped') throw new Error('Diagnostic workload did not stop');
      await this.start(original, signal);
      await report({
        percent: 90,
        stage: 'verifying',
        message: 'Verifying final state and cleanup',
      });
      const running = await this.status(original, signal);
      if (running.state !== 'running' || !(await this.healthy(original, signal))) {
        throw new Error('Diagnostic workload did not recover after restart');
      }
    } finally {
      // A stale worker must not remove a replacement created by a newer lease.
      if (!signal.aborted) {
        await this.remove(original, signal).catch(() => undefined);
        if (!imageWasPresent) {
          await this.removeImage(original.imageRef, signal).catch(() => undefined);
        }
        await this.removeNetworkIfEmpty(original, signal).catch(() => undefined);
      }
    }
  }

  async pullImage(imageRef: string, signal: AbortSignal): Promise<void> {
    if (!IMAGE_REF_PATTERN.test(imageRef))
      throw new Error('Image reference must use an immutable sha256 digest');
    if (await this.imageMatches(imageRef, signal)) return;
    const response = await this.request({
      method: 'POST',
      path: `/images/create?fromImage=${encodeURIComponent(imageRef)}`,
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMs: 120_000,
      signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300)
      throw dockerError(response, 'pull image');
    if (!(await this.imageMatches(imageRef, signal))) {
      throw new Error('Docker pulled an image that does not expose the requested RepoDigest');
    }
  }

  async deployProject(
    rawPayload: unknown,
    rawDelivery: unknown,
    archive: AsyncIterable<Uint8Array>,
    jobId: string,
    signal: AbortSignal,
    report: ProgressReporter,
  ): Promise<DockerWorkloadStatus> {
    const payload = parseProjectPayload(rawPayload);
    const delivery = parseProjectDelivery(rawDelivery);
    let imageWasPresent = false;
    try {
      await report({ percent: 8, stage: 'working', message: 'Receiving verified image artifact' });
      imageWasPresent = await this.imageExists(payload.imageRef, signal);
      await this.loadImageArchive(
        payload.imageRef,
        archive,
        delivery.artifact.sha256,
        delivery.artifact.sizeBytes,
        signal,
      );
      await report({
        percent: 38,
        stage: 'working',
        message: 'Creating isolated candidate workload',
      });
      const status = await this.deploy(payload, jobId, signal, delivery.envVars);
      await report({
        percent: 82,
        stage: 'verifying',
        message: 'Verifying published workload health',
      });
      if (status.state !== 'running' || !(await this.healthy(payload, signal))) {
        throw new Error('Published workload did not pass final health verification');
      }
      await report({ percent: 96, stage: 'verifying', message: 'Publishing deployment result' });
      return status;
    } catch (error) {
      // Only discard an image introduced by this failed attempt. A preexisting
      // tag can still back the currently published revision.
      if (!imageWasPresent && !signal.aborted) {
        await this.removeImage(payload.imageRef, signal).catch(() => undefined);
      }
      throw error;
    }
  }

  async loadImageArchive(
    imageRef: string,
    archive: AsyncIterable<Uint8Array>,
    expectedSha256: string,
    expectedSize: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (!PROJECT_IMAGE_REF_PATTERN.test(imageRef))
      throw new Error('Tested image reference is invalid');
    if (!SHA256_PATTERN.test(expectedSha256)) throw new Error('Artifact digest is invalid');
    let size = 0;
    const hash = createHash('sha256');
    const verified = (async function* () {
      for await (const rawChunk of archive) {
        if (signal.aborted) throw new Error('Agent job interrupted');
        const chunk = Buffer.from(rawChunk);
        size += chunk.length;
        if (size > expectedSize) throw new Error('Artifact stream exceeds its recorded size');
        hash.update(chunk);
        yield chunk;
      }
      if (size !== expectedSize) throw new Error('Artifact stream size does not match its record');
      if (hash.digest('hex') !== expectedSha256) {
        throw new Error('Artifact stream SHA-256 does not match its record');
      }
    })();
    const response = await this.request({
      method: 'POST',
      path: '/images/load?quiet=1',
      headers: { 'content-type': 'application/x-tar' },
      body: verified,
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMs: 10 * 60_000,
      signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw dockerError(response, 'load image archive');
    }
    if (!(await this.imageExists(imageRef, signal))) {
      throw new Error('Loaded image archive did not create its expected tested tag');
    }
  }

  async deploy(
    payload: DockerLifecyclePayload,
    jobId: string,
    signal: AbortSignal,
    envVars: Record<string, string> = {},
  ): Promise<DockerWorkloadStatus> {
    const desired = this.validatedPayload(payload);
    const baseName = this.containerName(desired);
    const candidateName = this.candidateName(desired);
    const current =
      desired.routingMode === 'managed-gateway'
        ? await this.desiredManagedContainer(desired, signal)
        : await this.desiredDirectContainer(desired, signal);
    if (current && this.matches(current, desired)) {
      if (!current.State?.Running) await this.start(desired, signal);
      if (!(await this.healthy(desired, signal)))
        throw new Error('Existing workload failed its health check');
      return this.status(desired, signal);
    }

    await this.ensureNetwork(desired, signal);
    for (const legacyCandidateName of this.legacyCandidateNames(desired)) {
      const legacyCandidate = await this.legacyOwnedContainer(legacyCandidateName, desired, signal);
      if (legacyCandidate) await this.removeContainer(legacyCandidate.Id, signal);
    }
    const existingCandidate = await this.ownedContainer(candidateName, desired, signal);
    if (existingCandidate && !this.matches(existingCandidate, desired)) {
      await this.removeContainer(existingCandidate.Id, signal);
    }
    let candidate = await this.inspectContainer(candidateName, signal);
    if (!candidate) {
      candidate = await this.createCandidate(desired, candidateName, jobId, envVars, signal);
    } else if (!candidate.State?.Running) {
      await this.expect(
        [204, 304],
        {
          method: 'POST',
          path: `/containers/${encodeURIComponent(candidate.Id)}/start`,
          signal,
        },
        'start candidate',
      );
      candidate = await this.inspectContainer(candidate.Id, signal);
    }
    const health: HealthProbe = candidate
      ? await this.probeHealth(candidate, desired, signal, this.healthTimeoutMs)
      : { ok: false, detail: 'the candidate container disappeared' };
    if (!candidate || !health.ok) {
      const tail = candidate ? await this.logTail(candidate.Id, signal) : '';
      // A stale worker (signal aborted after a lost lease) must not remove a
      // candidate a newer lease may already be verifying.
      if (candidate && !signal.aborted) {
        await this.removeContainer(candidate.Id, AbortSignal.timeout(CLEANUP_TIMEOUT_MS)).catch(
          () => undefined,
        );
      }
      throw new Error(
        `Candidate workload failed its health check: ${this.healthFailure(health)}${
          tail ? `; last log: ${tail}` : ''
        }`,
      );
    }
    await this.expect(
      [200],
      {
        method: 'POST',
        path: `/containers/${encodeURIComponent(candidate.Id)}/update`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ RestartPolicy: { Name: 'unless-stopped' } }),
        signal,
      },
      'set durable restart policy',
    );
    if (current) await this.removeContainer(current.Id, signal);
    await this.expect(
      [204],
      {
        method: 'POST',
        path: `/containers/${encodeURIComponent(candidate.Id)}/rename?name=${encodeURIComponent(baseName)}`,
        signal,
      },
      'publish candidate',
    );
    const replacedImage = current?.Config?.Image;
    if (
      desired.routingMode === 'direct-port' &&
      replacedImage &&
      replacedImage !== desired.imageRef &&
      PROJECT_IMAGE_REF_PATTERN.test(replacedImage)
    ) {
      // Same rule as managed-gateway commit: a redeploy re-delivers its
      // artifact, so the replaced image is only disk usage. Docker answers 409
      // while another environment still uses the build-once image.
      await this.removeImage(replacedImage, signal).catch(() => undefined);
    }
    return this.status(desired, signal);
  }

  private async createCandidate(
    desired: DockerLifecyclePayload,
    candidateName: string,
    jobId: string,
    envVars: Record<string, string>,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    const portKey = `${desired.containerPort}/tcp`;
    const memoryMb = desired.memoryLimitMb!;
    const cpu = desired.cpuLimitMillicores! / 1_000;
    const pids = desired.pidsLimit!;
    const tried = new Set<number>();
    for (let attempt = 1; ; attempt += 1) {
      // Direct-port workloads get an explicit host port: Docker re-randomizes
      // an empty HostPort on every container or host restart (ADR-180).
      const hostPort =
        desired.routingMode === 'direct-port'
          ? await this.allocateDirectPort(desired, tried, signal)
          : null;
      const created = responseJson<{ Id: string }>(
        await this.request({
          method: 'POST',
          path: `/containers/create?name=${encodeURIComponent(candidateName)}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            Image: desired.imageRef,
            Labels: {
              ...this.labels(desired, jobId),
              ...(hostPort ? { [HOST_PORT_LABEL]: String(hostPort) } : {}),
            },
            ...(Object.keys(envVars).length
              ? { Env: Object.entries(envVars).map(([key, value]) => `${key}=${value}`) }
              : {}),
            ExposedPorts: { [portKey]: {} },
            HostConfig: {
              NetworkMode: this.networkName(desired),
              PortBindings: {
                [portKey]: [
                  {
                    HostIp:
                      desired.routingMode === 'managed-gateway'
                        ? process.env.INITPAD_AGENT_MANAGED_HEALTH_BIND?.trim() || '127.0.0.1'
                        : '0.0.0.0',
                    HostPort: hostPort ? String(hostPort) : '',
                  },
                ],
              },
              Memory: Math.round(memoryMb * 1024 * 1024),
              MemorySwap: Math.round(memoryMb * 1024 * 1024),
              NanoCpus: Math.round(cpu * 1_000_000_000),
              PidsLimit: Math.round(pids),
              CapDrop: ['ALL'],
              CapAdd: [...SAFE_RUNTIME_CAPABILITIES],
              SecurityOpt: ['no-new-privileges'],
              Init: true,
              // A broken candidate must fail once instead of entering a restart
              // storm. The durable policy is applied only after health succeeds.
              RestartPolicy: { Name: 'no' },
              LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
            },
          }),
          signal,
        }),
        'create container',
      );
      try {
        await this.expect(
          [204, 304],
          {
            method: 'POST',
            path: `/containers/${encodeURIComponent(created.Id)}/start`,
            signal,
          },
          'start candidate',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (hostPort && attempt < MAX_PORT_ATTEMPTS && PORT_CONFLICT.test(message)) {
          // A process outside Docker holds the port; try the next free one.
          tried.add(hostPort);
          await this.removeContainer(created.Id, signal);
          continue;
        }
        throw error;
      }
      return this.inspectContainer(created.Id, signal);
    }
  }

  private async allocateDirectPort(
    desired: DockerLifecyclePayload,
    tried: Set<number>,
    signal: AbortSignal,
  ): Promise<number> {
    const containers = responseJson<ContainerListItem[]>(
      await this.request({
        method: 'GET',
        path: '/containers/json?all=1',
        maxResponseBytes: 16 * 1024 * 1024,
        signal,
      }),
      'list containers for host ports',
    );
    const used = new Set(tried);
    for (const container of Array.isArray(containers) ? containers : []) {
      for (const port of container.Ports ?? []) {
        if (Number.isInteger(port.PublicPort)) used.add(Number(port.PublicPort));
      }
      // Stopped containers list no ports, yet keep their binding for restart.
      const reserved = Number(container.Labels?.[HOST_PORT_LABEL]);
      if (Number.isInteger(reserved)) used.add(reserved);
    }
    const { first, last } = this.directPortRange;
    const size = last - first + 1;
    // A workload-stable starting point keeps a project on the same one or two
    // ports across redeploys instead of drifting through the range.
    const offset =
      Number.parseInt(
        createHash('sha256').update(this.workloadKey(desired)).digest('hex').slice(0, 8),
        16,
      ) % size;
    for (let index = 0; index < size; index += 1) {
      const port = first + ((offset + index) % size);
      if (!used.has(port)) return port;
    }
    throw new Error(
      `No free host port left in ${first}-${last}; widen INITPAD_AGENT_DIRECT_PORT_RANGE on the Agent`,
    );
  }

  rollback(
    payload: DockerLifecyclePayload,
    jobId: string,
    signal: AbortSignal,
  ): Promise<DockerWorkloadStatus> {
    return this.deploy(payload, jobId, signal);
  }

  async stop(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<void> {
    const desired = this.validatedPayload(payload);
    const container = await this.desiredContainer(desired, signal);
    if (!container || !container.State?.Running) return;
    await this.expect(
      [204, 304],
      {
        method: 'POST',
        path: `/containers/${encodeURIComponent(container.Id)}/stop?t=10`,
        signal,
      },
      'stop container',
    );
  }

  async start(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<void> {
    const desired = this.validatedPayload(payload);
    const container = await this.desiredContainer(desired, signal);
    if (!container) throw new Error('Workload does not exist');
    if (!container.State?.Running) {
      await this.expect(
        [204, 304],
        {
          method: 'POST',
          path: `/containers/${encodeURIComponent(container.Id)}/start`,
          signal,
        },
        'start container',
      );
    }
    const started = await this.desiredContainer(desired, signal);
    const health: HealthProbe = started
      ? await this.probeHealth(started, desired, signal, this.healthTimeoutMs)
      : { ok: false, detail: 'the workload container disappeared' };
    if (!health.ok) {
      throw new Error(
        `Workload failed its health check after start: ${this.healthFailure(health)}`,
      );
    }
  }

  async remove(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<void> {
    const desired = this.validatedPayload(payload);
    for (const name of [this.containerName(desired), this.candidateName(desired)]) {
      const container = await this.ownedContainer(name, desired, signal);
      if (container) await this.removeContainer(container.Id, signal);
    }
    for (const name of this.legacyContainerNames(desired)) {
      const container = await this.legacyOwnedContainer(name, desired, signal);
      if (container) await this.removeContainer(container.Id, signal);
    }
  }

  async removeProject(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<void> {
    const desired = this.validatedPayload(payload);
    const imageRefs = new Set([desired.imageRef]);
    if (desired.routingMode === 'managed-gateway') {
      const revisions = await this.ownedManagedRevisions(desired, signal);
      for (const revision of revisions) {
        await this.removeContainer(revision.Id, signal);
        if (
          typeof revision.Image === 'string' &&
          (PROJECT_IMAGE_REF_PATTERN.test(revision.Image) || IMAGE_REF_PATTERN.test(revision.Image))
        ) {
          imageRefs.add(revision.Image);
        }
      }
    } else {
      await this.remove(desired, signal);
    }
    for (const imageRef of imageRefs) await this.removeImage(imageRef, signal);
    await this.removeNetworkIfEmpty(desired, signal);
  }

  async status(
    payload: DockerLifecyclePayload,
    signal: AbortSignal,
  ): Promise<DockerWorkloadStatus> {
    const desired = this.validatedPayload(payload);
    const container = await this.desiredContainer(desired, signal);
    return container ? this.toStatus(container, desired) : { state: 'missing' };
  }

  async healthy(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<boolean> {
    const desired = this.validatedPayload(payload);
    const container = await this.desiredContainer(desired, signal);
    return container ? this.waitHealthy(container, desired, signal) : false;
  }

  async logs(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<string> {
    const desired = this.validatedPayload(payload);
    const container = await this.desiredContainer(desired, signal);
    if (!container) return '';
    return this.containerLogs(container.Id, signal);
  }

  async diagnostics(rawPayload: unknown, signal: AbortSignal): Promise<DockerWorkloadDiagnostic> {
    const payload = parseDiagnosticPayload(rawPayload);
    let container: ContainerInspect | null;
    if (payload.routingMode === 'managed-gateway') {
      const revisions = await this.ownedManagedRevisions(payload, signal);
      const matching = revisions.filter(
        (revision) => revision.Labels?.['com.initpad.revision'] === payload.revision,
      );
      if (matching.length > 1) {
        throw new Error('Agent found multiple workload revisions for this diagnostic snapshot');
      }
      container = matching[0] ? await this.ownedContainer(matching[0].Id, payload, signal) : null;
    } else {
      container = await this.desiredDirectContainer(payload, signal);
    }
    if (!container) return { state: 'missing', health: 'missing', logs: '' };

    const status = this.toStatus(container, payload);
    const logs = await this.containerLogs(container.Id, signal);
    const exitCode = Number(container.State?.ExitCode);
    if (status.state !== 'running') {
      return {
        ...status,
        ...(Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? { exitCode } : {}),
        health: 'not-running',
        logs,
      };
    }
    return {
      ...status,
      health: (await this.waitHealthy(container, payload, signal, DIAGNOSTIC_HEALTH_TIMEOUT_MS))
        ? 'healthy'
        : 'unhealthy',
      logs,
    };
  }

  private async containerLogs(containerId: string, signal: AbortSignal): Promise<string> {
    const response = await this.request({
      method: 'GET',
      path: `/containers/${encodeURIComponent(containerId)}/logs?stdout=1&stderr=1&tail=200`,
      maxResponseBytes: MAX_LOG_BYTES + 8 * 200,
      signal,
    });
    if (response.statusCode !== 200) throw dockerError(response, 'read logs');
    return demuxLogs(response.body);
  }

  private async imageMatches(imageRef: string, signal: AbortSignal): Promise<boolean> {
    const response = await this.request({
      method: 'GET',
      path: `/images/${encodeURIComponent(imageRef)}/json`,
      signal,
    });
    if (response.statusCode === 404) return false;
    const image = responseJson<ImageInspect>(response, 'inspect image');
    const digest = imageRef.slice(imageRef.indexOf('@'));
    return Boolean(image.Id && image.RepoDigests?.some((item) => item.endsWith(digest)));
  }

  private async imageExists(imageRef: string, signal: AbortSignal): Promise<boolean> {
    const response = await this.request({
      method: 'GET',
      path: `/images/${encodeURIComponent(imageRef)}/json`,
      signal,
    });
    if (response.statusCode === 404) return false;
    return Boolean(responseJson<ImageInspect>(response, 'inspect image').Id);
  }

  private async removeImage(imageRef: string, signal: AbortSignal): Promise<void> {
    const response = await this.request({
      method: 'DELETE',
      path: `/images/${encodeURIComponent(imageRef)}?force=false&noprune=false`,
      signal,
    });
    if (![200, 404, 409].includes(response.statusCode)) throw dockerError(response, 'remove image');
  }

  private async ensureNetwork(payload: DockerLifecyclePayload, signal: AbortSignal): Promise<void> {
    const name = this.networkName(payload);
    const inspected = await this.request({
      method: 'GET',
      path: `/networks/${encodeURIComponent(name)}`,
      signal,
    });
    if (inspected.statusCode === 200) {
      this.assertNetworkOwnership(
        responseJson<NetworkInspect>(inspected, 'inspect network'),
        payload,
      );
      return;
    }
    if (inspected.statusCode !== 404) throw dockerError(inspected, 'inspect network');
    const created = await this.request({
      method: 'POST',
      path: '/networks/create',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Name: name,
        CheckDuplicate: true,
        Labels: {
          'com.initpad.managed': 'true',
          'com.initpad.target': this.targetId,
          'com.initpad.allocation.id': payload.allocationId,
          'com.initpad.allocation.namespace': payload.namespace,
          'com.initpad.environment': payload.environment,
          'com.initpad.project': payload.projectSlug,
          'com.initpad.routing.mode': payload.routingMode,
        },
      }),
      signal,
    });
    if (created.statusCode === 201) return;
    if (created.statusCode !== 409) throw dockerError(created, 'create network');
    const raced = await this.request({
      method: 'GET',
      path: `/networks/${encodeURIComponent(name)}`,
      signal,
    });
    this.assertNetworkOwnership(
      responseJson<NetworkInspect>(raced, 'inspect raced network'),
      payload,
    );
  }

  private async removeNetworkIfEmpty(
    payload: DockerLifecyclePayload,
    signal: AbortSignal,
  ): Promise<void> {
    await this.removeNamedNetworkIfEmpty(this.networkName(payload), payload, signal, false);
    await this.removeNamedNetworkIfEmpty(legacyWorkloadNetworkName(payload), payload, signal, true);
  }

  private async removeNamedNetworkIfEmpty(
    name: string,
    payload: DockerLifecyclePayload,
    signal: AbortSignal,
    legacy: boolean,
  ): Promise<void> {
    const inspected = await this.request({
      method: 'GET',
      path: `/networks/${encodeURIComponent(name)}`,
      signal,
    });
    if (inspected.statusCode === 404) return;
    const network = responseJson<NetworkInspect>(inspected, 'inspect network');
    if (legacy && !this.networkBelongsToAllocation(network, payload)) return;
    this.assertNetworkOwnership(network, payload);
    if (!network.Containers || Object.keys(network.Containers).length > 0) return;
    await this.expect(
      [204, 404],
      {
        method: 'DELETE',
        path: `/networks/${encodeURIComponent(name)}`,
        signal,
      },
      'remove empty workload network',
    );
  }

  private async inspectContainer(
    name: string,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    const response = await this.request({
      method: 'GET',
      path: `/containers/${encodeURIComponent(name)}/json`,
      signal,
    });
    if (response.statusCode === 404) return null;
    return responseJson<ContainerInspect>(response, 'inspect container');
  }

  private async ownedContainer(
    name: string,
    payload: DockerLifecyclePayload | DockerDiagnosticPayload,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    const container = await this.inspectContainer(name, signal);
    if (container && !this.belongsToWorkload(container, payload)) {
      throw new Error(
        `Docker container name collision outside allocation '${payload.allocationId}'`,
      );
    }
    return container;
  }

  private async legacyOwnedContainer(
    name: string,
    payload: DockerLifecyclePayload | DockerDiagnosticPayload,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    const container = await this.inspectContainer(name, signal);
    return container && this.belongsToWorkload(container, payload) ? container : null;
  }

  private async ownedManagedRevisions(
    payload: DockerLifecyclePayload | DockerDiagnosticPayload,
    signal: AbortSignal,
  ): Promise<ContainerListItem[]> {
    const workloadKey = this.workloadKey(payload);
    const filters = encodeURIComponent(
      JSON.stringify({
        label: [
          'com.initpad.managed=true',
          `com.initpad.target=${this.targetId}`,
          `com.initpad.allocation.id=${payload.allocationId}`,
          `com.initpad.workload=${workloadKey}`,
          'com.initpad.routing.mode=managed-gateway',
        ],
      }),
    );
    const response = await this.request({
      method: 'GET',
      path: `/containers/json?all=1&filters=${filters}`,
      signal,
    });
    const containers = responseJson<ContainerListItem[]>(
      response,
      'list managed workload revisions',
    );
    if (!Array.isArray(containers) || containers.length > 256) {
      throw new Error('Docker returned an invalid managed workload revision list');
    }
    for (const container of containers) {
      const labels = container.Labels ?? {};
      if (
        !container.Id ||
        labels['com.initpad.managed'] !== 'true' ||
        labels['com.initpad.target'] !== this.targetId ||
        labels['com.initpad.allocation.id'] !== payload.allocationId ||
        labels['com.initpad.allocation.namespace'] !== payload.namespace ||
        labels['com.initpad.project'] !== payload.projectSlug ||
        labels['com.initpad.environment'] !== payload.environment ||
        labels['com.initpad.workload'] !== workloadKey ||
        labels['com.initpad.routing.mode'] !== 'managed-gateway' ||
        container.Names?.length !== 1 ||
        !/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container.Names[0])
      ) {
        throw new Error('Docker returned a workload outside the managed project allocation');
      }
    }
    return containers;
  }

  private async removeContainer(id: string, signal: AbortSignal): Promise<void> {
    await this.expect(
      [204, 404],
      {
        method: 'DELETE',
        path: `/containers/${encodeURIComponent(id)}?force=true&v=true`,
        signal,
      },
      'remove container',
    );
  }

  private async waitHealthy(
    container: ContainerInspect,
    payload: Pick<DockerLifecyclePayload, 'containerPort' | 'healthPath'>,
    signal: AbortSignal,
    timeoutMs = this.healthTimeoutMs,
  ): Promise<boolean> {
    return (await this.probeHealth(container, payload, signal, timeoutMs)).ok;
  }

  /** Polls the health path until it answers 2xx or the budget from now runs out. */
  private async probeHealth(
    container: ContainerInspect,
    payload: Pick<DockerLifecyclePayload, 'containerPort' | 'healthPath'>,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<HealthProbe> {
    if (!container.State?.Running) {
      return { ok: false, detail: this.exitDetail(container) };
    }
    const mapping = container.NetworkSettings?.Ports?.[`${payload.containerPort}/tcp`];
    const hostPort = Number(mapping?.[0]?.HostPort);
    if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65_535) {
      return { ok: false, detail: `container port ${payload.containerPort} is not published` };
    }
    const url = `http://${this.host}:${hostPort}${payload.healthPath}`;
    const deadline = Date.now() + timeoutMs;
    let last = 'no response';
    for (let attempt = 1; !signal.aborted; attempt += 1) {
      const remaining = deadline - Date.now();
      try {
        const response = await this.fetchImpl(url, {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(Math.max(250, Math.min(3_000, remaining))),
          ]),
        });
        await response.body?.cancel().catch(() => undefined);
        if (response.ok) return { ok: true, url, detail: `HTTP ${response.status}` };
        last = `returned HTTP ${response.status}`;
      } catch (error) {
        last = describeFetchFailure(error, 'timed out');
      }
      if (Date.now() + 500 >= deadline) break;
      if (attempt % 4 === 0) {
        // A crashed process will never become healthy; stop waiting early.
        const fresh = await this.inspectContainer(container.Id, signal).catch(() => null);
        if (fresh && !fresh.State?.Running) {
          return { ok: false, url, detail: this.exitDetail(fresh) };
        }
      }
      await sleep(500, undefined, { signal }).catch(() => undefined);
    }
    return {
      ok: false,
      url,
      detail: signal.aborted ? 'interrupted' : `${last} after ${Math.round(timeoutMs / 1_000)} s`,
    };
  }

  private exitDetail(container: ContainerInspect): string {
    const code = Number(container.State?.ExitCode);
    return Number.isInteger(code) && code > 0
      ? `the container exited with code ${code}`
      : 'the container is not running';
  }

  private healthFailure(health: HealthProbe): string {
    return health.url ? `GET ${health.url} ${health.detail}` : health.detail;
  }

  private async logTail(containerId: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return '';
    const logs = await this.containerLogs(containerId, signal).catch(() => '');
    return logs
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3)
      .join(' | ')
      .slice(-160);
  }

  private toStatus(
    container: ContainerInspect,
    payload: DockerLifecyclePayload | DockerDiagnosticPayload,
  ): DockerWorkloadStatus {
    const mapping = container.NetworkSettings?.Ports?.[`${payload.containerPort}/tcp`];
    const hostPort = Number(mapping?.[0]?.HostPort);
    const workloadSlot =
      container.Config?.Labels?.['com.initpad.workload.slot'] ??
      ('imageRef' in payload ? managedWorkloadSlot(payload) : undefined);
    return {
      state: container.State?.Running ? 'running' : 'stopped',
      revision: container.Config?.Labels?.['com.initpad.revision'],
      ...(Number.isInteger(hostPort) && hostPort > 0 ? { hostPort } : {}),
      ...(payload.routingMode === 'managed-gateway' && workloadSlot ? { workloadSlot } : {}),
    };
  }

  private matches(container: ContainerInspect, payload: DockerLifecyclePayload): boolean {
    return (
      this.belongsToWorkload(container, payload) &&
      container.Config?.Labels?.['com.initpad.revision'] === payload.revision &&
      (!payload.configFingerprint ||
        container.Config?.Labels?.['com.initpad.config-fingerprint'] ===
          payload.configFingerprint) &&
      container.Config?.Image === payload.imageRef
    );
  }

  private belongsToWorkload(
    container: ContainerInspect,
    payload: Pick<DockerLifecyclePayload, 'allocationId' | 'projectSlug' | 'environment'>,
  ): boolean {
    const labels = container.Config?.Labels ?? {};
    return (
      labels['com.initpad.target'] === this.targetId &&
      labels['com.initpad.allocation.id'] === payload.allocationId &&
      labels['com.initpad.workload'] === this.workloadKey(payload)
    );
  }

  private assertNetworkOwnership(network: NetworkInspect, payload: DockerLifecyclePayload): void {
    if (!this.networkBelongsToAllocation(network, payload)) {
      throw new Error(`Docker network name collision outside allocation '${payload.allocationId}'`);
    }
  }

  private networkBelongsToAllocation(
    network: NetworkInspect,
    payload: DockerLifecyclePayload,
  ): boolean {
    const labels = network.Labels ?? {};
    return !(
      labels['com.initpad.managed'] !== 'true' ||
      labels['com.initpad.target'] !== this.targetId ||
      labels['com.initpad.allocation.id'] !== payload.allocationId ||
      labels['com.initpad.allocation.namespace'] !== payload.namespace ||
      labels['com.initpad.environment'] !== payload.environment ||
      (payload.routingMode === 'managed-gateway' &&
        (labels['com.initpad.project'] !== payload.projectSlug ||
          labels['com.initpad.routing.mode'] !== 'managed-gateway')) ||
      (payload.routingMode === 'direct-port' &&
        labels['com.initpad.routing.mode'] !== undefined &&
        labels['com.initpad.routing.mode'] !== 'direct-port')
    );
  }

  private labels(payload: DockerLifecyclePayload, jobId: string): Record<string, string> {
    return {
      'com.initpad.managed': 'true',
      'com.initpad.target': this.targetId,
      'com.initpad.allocation.id': payload.allocationId,
      'com.initpad.allocation.namespace': payload.namespace,
      'com.initpad.project': payload.projectSlug,
      'com.initpad.environment': payload.environment,
      'com.initpad.routing.mode': payload.routingMode,
      'com.initpad.workload': this.workloadKey(payload),
      'com.initpad.revision': payload.revision,
      ...(payload.routingMode === 'managed-gateway'
        ? { 'com.initpad.workload.slot': managedWorkloadSlot(payload) }
        : {}),
      'com.initpad.job': jobId,
      ...(payload.configFingerprint
        ? { 'com.initpad.config-fingerprint': payload.configFingerprint }
        : {}),
    };
  }

  private validatedPayload(payload: DockerLifecyclePayload): DockerLifecyclePayload {
    return payload.configFingerprint
      ? parseProjectPayload(payload)
      : parseLifecyclePayload(payload);
  }

  private workloadKey(
    payload: Pick<DockerLifecyclePayload, 'allocationId' | 'projectSlug' | 'environment'>,
  ): string {
    return `${payload.allocationId}:${payload.projectSlug}:${payload.environment}`;
  }

  private networkName(payload: DockerLifecyclePayload): string {
    return workloadNetworkName(payload);
  }

  private containerName(payload: DockerLifecyclePayload): string {
    return payload.routingMode === 'managed-gateway'
      ? managedWorkloadContainerName(payload, managedWorkloadSlot(payload))
      : workloadContainerName(payload);
  }

  private async desiredDirectContainer(
    payload: DockerLifecyclePayload | DockerDiagnosticPayload,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    const current = await this.ownedContainer(workloadContainerName(payload), payload, signal);
    if (current) return current;
    return this.legacyOwnedContainer(legacyWorkloadContainerName(payload), payload, signal);
  }

  private async desiredContainer(
    payload: DockerLifecyclePayload,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    return payload.routingMode === 'managed-gateway'
      ? this.desiredManagedContainer(payload, signal)
      : this.ownedContainer(this.containerName(payload), payload, signal);
  }

  private async desiredManagedContainer(
    payload: DockerLifecyclePayload,
    signal: AbortSignal,
  ): Promise<ContainerInspect | null> {
    const desired = await this.ownedContainer(this.containerName(payload), payload, signal);
    if (desired) {
      if (!this.matches(desired, payload)) {
        throw new Error('Managed workload slot collides with another immutable deployment');
      }
      return desired;
    }
    for (const name of [
      legacyManagedWorkloadContainerName(payload, managedWorkloadSlot(payload)),
      legacyWorkloadContainerName(payload),
    ]) {
      const legacy = await this.legacyOwnedContainer(name, payload, signal);
      if (legacy && this.matches(legacy, payload)) return legacy;
    }
    return null;
  }

  private candidateName(payload: DockerLifecyclePayload): string {
    const suffix = dockerNamePart(payload.revision).slice(0, 12);
    return `${this.containerName(payload).slice(0, 108)}-next-${suffix}`;
  }

  private legacyContainerNames(payload: DockerLifecyclePayload): string[] {
    const suffix = dockerNamePart(payload.revision).slice(0, 12);
    const bases =
      payload.routingMode === 'managed-gateway'
        ? [
            legacyManagedWorkloadContainerName(payload, managedWorkloadSlot(payload)),
            legacyWorkloadContainerName(payload),
          ]
        : [legacyWorkloadContainerName(payload)];
    return [...new Set(bases.flatMap((base) => [base, `${base.slice(0, 108)}-next-${suffix}`]))];
  }

  private legacyCandidateNames(payload: DockerLifecyclePayload): string[] {
    const desired = this.candidateName(payload);
    return this.legacyContainerNames(payload).filter(
      (name) => name.includes('-next-') && name !== desired,
    );
  }

  private request(input: Parameters<DockerTransport>[0]): Promise<DockerHttpResponse> {
    return this.transport(input, this.dockerHost);
  }

  private async expect(
    statuses: number[],
    input: Parameters<DockerTransport>[0],
    action: string,
  ): Promise<void> {
    const response = await this.request(input);
    if (!statuses.includes(response.statusCode)) throw dockerError(response, action);
  }
}
