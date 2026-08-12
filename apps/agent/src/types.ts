export const AGENT_VERSION = '0.3.0';
export const PROTOCOL_VERSION = 1;

export interface AgentConfig {
  controlPlaneUrl: string;
  agentId: string;
  targetId: string;
  credential: string;
  credentialGeneration: number;
  protocolVersion: number;
  enrolledAt: string;
}

export interface DockerCapabilities {
  engineVersion: string;
  apiVersion: string;
  os: string;
  arch: string;
  rootless: boolean;
  cpus: number;
  memoryBytes: number;
}

export interface EnrollmentResponse {
  agentId: string;
  targetId: string;
  credential: string;
  credentialGeneration: number;
  protocolVersion: number;
}

export interface HeartbeatResponse {
  targetId: string;
  credentialGeneration: number;
  acceptedAt: string;
  nextHeartbeatSeconds: number;
}

export interface AgentJobClaim {
  id: string;
  targetId: string;
  kind: string;
  protocolVersion: number;
  payload: unknown;
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: string;
  delivery?: {
    artifact: {
      path: string;
      sha256: string;
      sizeBytes: number;
    };
    envVars: Record<string, string>;
  };
}

export interface AgentJobSummary {
  id: string;
  kind: string;
  status: string;
  attempt: number;
  progressSequence: number;
  progressPercent: number;
  progressStage: string;
  message: string | null;
  resultCode: string | null;
  createdAt: string;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
  finishedAt: string | null;
}

export interface ClaimJobResponse {
  job: AgentJobClaim | null;
  nextPollSeconds: number;
}
