import { AGENT_VERSION, PROTOCOL_VERSION } from './types.js';
import type {
  AgentConfig,
  AgentJobSummary,
  ClaimJobResponse,
  DockerCapabilities,
  EnrollmentResponse,
  HeartbeatResponse,
} from './types.js';

const REQUEST_TIMEOUT_MS = 15_000;
type FetchLike = typeof fetch;

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

async function postJson<T>(
  controlPlaneUrl: string,
  path: string,
  body: unknown,
  credential?: string,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${controlPlaneUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const apiMessage = typeof payload?.message === 'string' ? payload.message : undefined;
      throw new ControlPlaneError(response.status, apiMessage || `Control plane returned HTTP ${response.status}`);
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function enroll(
  controlPlaneUrl: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<EnrollmentResponse> {
  return postJson<EnrollmentResponse>(controlPlaneUrl, '/api/agent/enroll', {
    token,
    version: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }, undefined, fetchImpl);
}

export function heartbeat(
  config: AgentConfig,
  docker: DockerCapabilities,
  fetchImpl: FetchLike = fetch,
): Promise<HeartbeatResponse> {
  return postJson<HeartbeatResponse>(config.controlPlaneUrl, '/api/agent/heartbeat', {
    version: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    docker,
  }, config.credential, fetchImpl);
}

export function claimJob(
  config: AgentConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ClaimJobResponse> {
  return postJson<ClaimJobResponse>(config.controlPlaneUrl, '/api/agent/jobs/claim', {
    version: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }, config.credential, fetchImpl);
}

export function renewJobLease(
  config: AgentConfig,
  jobId: string,
  leaseToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ leaseExpiresAt: string }> {
  return postJson(config.controlPlaneUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/lease`, {
    leaseToken,
  }, config.credential, fetchImpl);
}

/**
 * Streams one verified image archive under the current job lease. The Agent
 * credential identifies the physical target; the lease token fences this
 * concrete delivery attempt. Neither value is placed in the URL.
 */
export async function downloadJobArtifact(
  config: AgentConfig,
  jobId: string,
  leaseToken: string,
  path: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (path !== `/api/agent/jobs/${encodeURIComponent(jobId)}/artifact`) {
    throw new Error('Control plane returned an invalid Agent artifact path');
  }
  const response = await fetchImpl(`${config.controlPlaneUrl}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${config.credential}`,
      'x-initpad-job-lease': leaseToken,
    },
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const apiMessage = typeof payload?.message === 'string' ? payload.message : undefined;
    throw new ControlPlaneError(
      response.status,
      apiMessage || `Control plane returned HTTP ${response.status}`,
    );
  }
  if (!response.body) throw new Error('Control plane returned an empty artifact stream');
  return response;
}

export function reportJobProgress(
  config: AgentConfig,
  jobId: string,
  input: {
    leaseToken: string;
    sequence: number;
    percent: number;
    stage: 'accepted' | 'working' | 'verifying';
    message: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<AgentJobSummary> {
  return postJson(config.controlPlaneUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/progress`, input,
    config.credential, fetchImpl);
}

export function completeJob(
  config: AgentConfig,
  jobId: string,
  input: {
    leaseToken: string;
    status: 'succeeded' | 'failed';
    message: string;
    resultCode?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<AgentJobSummary> {
  return postJson(config.controlPlaneUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, input,
    config.credential, fetchImpl);
}
