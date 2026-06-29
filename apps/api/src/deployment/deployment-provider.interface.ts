import { ProviderKind } from '../domain/types';

export interface DeployInput {
  projectName: string;
  version: string;
  env: string;
  repoPath: string;
  port?: number;
}

export interface DeployResult {
  status: 'running' | 'failed';
  url: string;
}

// Zásuvný adaptér nasazení: platforma deleguje "kam a jak" na konkrétní
// implementaci (Docker, SFTP, SSH). Nový cíl = nová implementace tohoto rozhraní.
export interface DeploymentProvider {
  readonly kind: ProviderKind;
  deploy(input: DeployInput): Promise<DeployResult>;
}
