import { AGENT_VERSION, PROTOCOL_VERSION } from './types.js';
import type {
  AgentConfig,
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
