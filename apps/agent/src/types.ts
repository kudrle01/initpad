export const AGENT_VERSION = '0.1.0';
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
