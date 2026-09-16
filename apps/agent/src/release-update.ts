import { chmod, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { verify, type Bundle } from 'sigstore';
import { AGENT_VERSION } from './types.js';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const IMAGE = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_TOKEN = /^initpad_lease_[A-Za-z0-9_-]{43}$/;
const MAX_MANIFEST_BYTES = 512 * 1024;
const PLAN_DIRECTORY = '/var/lib/initpad-agent';

export interface AgentUpdatePayload {
  version: string;
  manifestBase64: string;
  bundle: Bundle;
}

export interface VerifiedAgentUpdate {
  version: string;
  image: string;
}

export interface AgentUpdatePlan {
  schemaVersion: 1;
  jobId: string;
  attempt: number;
  leaseToken: string;
  targetId: string;
  version: string;
  image: string;
  createdAt: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseVersion(value: unknown): readonly [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = value.match(STABLE_VERSION);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersion(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Agent update version is invalid');
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function decodeManifest(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_MANIFEST_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('Agent update manifest encoding is invalid');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_MANIFEST_BYTES) {
    throw new Error('Agent update manifest is outside the supported size');
  }
  if (bytes.toString('base64') !== value) {
    throw new Error('Agent update manifest encoding is not canonical');
  }
  return bytes;
}

function parseManifest(
  value: unknown,
  repository: string,
  expectedVersion: string,
): VerifiedAgentUpdate {
  const manifest = object(value);
  const source = object(manifest?.source);
  const image = object(manifest?.image);
  const installer = object(manifest?.installer);
  const tag = `agent-v${expectedVersion}`;
  const expectedRepository = `https://github.com/${repository}`;
  const immutableReference = image?.immutableReference;
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.component !== 'initpad-agent' ||
    manifest.version !== expectedVersion ||
    !parseVersion(manifest.version) ||
    source?.repository !== expectedRepository ||
    source.tag !== tag ||
    typeof source.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(source.commit) ||
    typeof image?.name !== 'string' ||
    typeof image.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(image.digest) ||
    typeof immutableReference !== 'string' ||
    !IMAGE.test(immutableReference) ||
    immutableReference !== `${image.name}@${image.digest}` ||
    !Array.isArray(image.platforms) ||
    !image.platforms.every(
      (platform) => typeof platform === 'string' && /^linux\/(amd64|arm64)$/.test(platform),
    ) ||
    installer?.file !== 'initpad-agent-install.sh' ||
    typeof installer.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(installer.sha256)
  ) {
    throw new Error('Agent update manifest is invalid');
  }
  const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
  if (!image.platforms.includes(`linux/${architecture}`)) {
    throw new Error('Agent update does not support this Linux architecture');
  }
  return { version: expectedVersion, image: immutableReference };
}

export async function verifyAgentUpdatePayload(
  value: unknown,
  repository = process.env.INITPAD_AGENT_RELEASE_REPOSITORY || 'kudrle01/initpad',
  verifier: typeof verify = verify,
): Promise<VerifiedAgentUpdate> {
  const payload = object(value);
  if (
    !payload ||
    Object.keys(payload).some((key) => !['version', 'manifestBase64', 'bundle'].includes(key))
  ) {
    throw new Error('Agent update payload is invalid');
  }
  if (typeof payload.version !== 'string' || !parseVersion(payload.version)) {
    throw new Error('Agent update version is invalid');
  }
  if (compareVersion(payload.version, AGENT_VERSION) <= 0) {
    throw new Error('Agent update must be newer than the running Agent');
  }
  const manifest = decodeManifest(payload.manifestBase64);
  const bundle = object(payload.bundle) as Bundle | null;
  if (!bundle) throw new Error('Agent update signature bundle is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.toString('utf8')) as unknown;
  } catch {
    throw new Error('Agent update manifest is not valid JSON');
  }
  const update = parseManifest(parsed, repository, payload.version);
  await verifier(bundle, manifest, {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI:
      `https://github.com/${repository}/.github/workflows/release-agent.yml` +
      `@refs/tags/agent-v${payload.version}`,
    tlogThreshold: 1,
    ctLogThreshold: 1,
    timeout: 8_000,
  });
  return update;
}

export function updatePlanPath(jobId: string, attempt: number): string {
  if (!JOB_ID.test(jobId) || !Number.isInteger(attempt) || attempt < 1 || attempt > 1_000_000) {
    throw new Error('Agent update job identity is invalid');
  }
  return join(PLAN_DIRECTORY, `update-${jobId}-${attempt}.json`);
}

export async function writeUpdatePlan(plan: AgentUpdatePlan): Promise<string> {
  assertUpdatePlan(plan);
  const path = updatePlanPath(plan.jobId, plan.attempt);
  await writeFile(path, `${JSON.stringify(plan)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function readUpdatePlan(path: string): Promise<AgentUpdatePlan> {
  if (dirname(path) !== PLAN_DIRECTORY || path !== updatePlanPathFromFilename(path)) {
    throw new Error('Agent update plan path is invalid');
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Agent update plan must be a mode-0600 regular file');
  }
  if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
    throw new Error('Agent update plan is owned by a different user');
  }
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 16 * 1024) throw new Error('Agent update plan is too large');
  const plan = JSON.parse(raw) as unknown;
  assertUpdatePlan(plan);
  if (path !== updatePlanPath(plan.jobId, plan.attempt)) {
    throw new Error('Agent update plan filename does not match its job');
  }
  return plan;
}

function updatePlanPathFromFilename(path: string): string {
  const match = path.match(/\/update-([0-9a-f-]{36})-(\d+)\.json$/i);
  if (!match) return '';
  return updatePlanPath(match[1], Number(match[2]));
}

function assertUpdatePlan(value: unknown): asserts value is AgentUpdatePlan {
  const plan = object(value);
  if (
    !plan ||
    Object.keys(plan).some(
      (key) =>
        ![
          'schemaVersion',
          'jobId',
          'attempt',
          'leaseToken',
          'targetId',
          'version',
          'image',
          'createdAt',
        ].includes(key),
    ) ||
    plan.schemaVersion !== 1 ||
    typeof plan.jobId !== 'string' ||
    !JOB_ID.test(plan.jobId) ||
    !Number.isInteger(plan.attempt) ||
    Number(plan.attempt) < 1 ||
    Number(plan.attempt) > 1_000_000 ||
    typeof plan.leaseToken !== 'string' ||
    !LEASE_TOKEN.test(plan.leaseToken) ||
    typeof plan.targetId !== 'string' ||
    !JOB_ID.test(plan.targetId) ||
    typeof plan.version !== 'string' ||
    !parseVersion(plan.version) ||
    typeof plan.image !== 'string' ||
    !IMAGE.test(plan.image) ||
    typeof plan.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(plan.createdAt))
  ) {
    throw new Error('Agent update plan is invalid');
  }
}

export async function removeUpdatePlan(path: string): Promise<void> {
  await rm(path, { force: true });
}
