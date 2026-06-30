import { ProviderKind } from '../domain/types';

export interface DeployInput {
  projectName: string;
  version: string;
  env: string;
  repoPath: string;
  port?: number;
  // Cesta pro post-deploy health check (ověření, že nasazení v tomto
  // prostředí reálně odpovídá). Default '/health'.
  healthPath?: string;
}

export interface DeployResult {
  status: 'running' | 'failed';
  url: string;
}

// Co je potřeba ke zrušení nasazení (zastavení kontejneru / procesu).
export interface TeardownInput {
  projectName: string;
  env: string;
}

// Zásuvný adaptér nasazení: platforma deleguje "kam a jak" na konkrétní
// implementaci (Docker, SFTP, SSH). Nový cíl = nová implementace tohoto rozhraní.
export interface DeploymentProvider {
  readonly kind: ProviderKind;
  deploy(input: DeployInput): Promise<DeployResult>;
  // Zruší nasazení daného prostředí; volitelné (stuby zatím nic nedělají).
  teardown?(input: TeardownInput): Promise<void>;
}
