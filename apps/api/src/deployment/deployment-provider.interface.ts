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
  // Odkaz na hotový image v registru (build once, deploy many). Když je zadán,
  // provider ho stáhne a spustí.
  imageRef?: string;
  // Smí provider při nedostupném image spadnout na lokální build z repoPath?
  // true jen pro bootstrap (první scaffold). U reálných deployů false → přísné
  // build-once: chybí-li otestovaný image, deploy selže (nespustí se jiný bit).
  allowBuildFallback?: boolean;
}

export interface DeployResult {
  status: 'running' | 'failed';
  url: string;
  // Lidsky čitelný důvod selhání (u status 'failed').
  reason?: string;
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
  // Vrátí posledních N řádků logu běžícího nasazení; volitelné.
  logs?(input: TeardownInput): Promise<string>;
  // Smaže všechny lokální image daného repa (<registry>/<owner>/<name>:*).
  removeImages?(repo: string): Promise<void>;
}
