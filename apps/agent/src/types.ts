export const AGENT_VERSION = '0.10.0';
export const PROTOCOL_VERSION = 1;

export interface AgentConfig {
  controlPlaneUrl: string;
  agentId: string;
  targetId: string;
  credential: string;
  credentialGeneration: number;
  previousCredential?: string;
  previousCredentialGeneration?: number;
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
  credentialConfirmed?: boolean;
  credentialRotation?: {
    credential: string;
    credentialGeneration: number;
  };
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

export interface AgentJobResult {
  state: 'running' | 'stopped' | 'missing';
  revision?: string;
  hostPort?: number;
  workloadSlot?: string;
}

export interface AgentJobDiagnostic {
  exitCode?: number;
  health: 'healthy' | 'unhealthy' | 'not-running' | 'missing';
  logs: string;
}

export interface ClaimJobResponse {
  job: AgentJobClaim | null;
  nextPollSeconds: number;
}
