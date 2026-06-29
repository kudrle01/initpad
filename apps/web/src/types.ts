export type ProviderKind = 'docker' | 'sftp' | 'ssh';
export type EnvName = 'dev' | 'test' | 'prod';
export type DeployStatus = 'empty' | 'deploying' | 'running' | 'failed';

export interface TemplateManifest {
  id: string;
  name: string;
  language: string;
  artifact: 'static' | 'runtime';
  compatibleProviders: ProviderKind[];
  description: string;
}

export interface Environment {
  name: EnvName;
  provider: ProviderKind;
  status: DeployStatus;
  version: string | null;
  url: string | null;
}

export interface Project {
  id: string;
  name: string;
  templateId: string;
  repoPath: string;
  repoUrl: string | null;
  createdAt: string;
  lastCommit: string;
  environments: Environment[];
}

export type StageStatus = 'pending' | 'running' | 'success' | 'failed';

export interface PipelineStage {
  name: string;
  status: StageStatus;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  pipeline: PipelineStage[];
}
