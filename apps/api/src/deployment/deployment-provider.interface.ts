import { ProviderKind } from '../domain/types';

export interface DeployInput {
  projectName: string;
  version: string;
  env: string;
  repoPath: string;
  port?: number;
  // Path used for the post-deploy health check (verifies the deployment
  // actually responds in this environment). Defaults to '/health'.
  healthPath?: string;
  // Reference to a pre-built image in the registry (build once, deploy many).
  // When set, the provider pulls and runs it instead of building.
  imageRef?: string;
  // May the provider fall back to a local build from repoPath when the image
  // is unavailable? True only for bootstrap (the initial scaffold). Real
  // deployments keep this false → strict build-once: if the tested image is
  // missing, the deployment fails rather than running a different artifact.
  allowBuildFallback?: boolean;
  // Command that starts the app for source-based deployments (from the
  // template manifest).
  startCommand?: string;
  // Subdirectory containing the artifact for static deployments (from the
  // template manifest).
  artifactDir?: string;
  // Application port allocated by the platform for source-based deployments
  // on a shared host (SSH). Allocated from the database, so it is unique
  // across all environments.
  appPort?: number;
}

export interface DeployResult {
  status: 'running' | 'failed';
  url: string;
  // Human-readable failure reason (present when status is 'failed').
  reason?: string;
}

// Everything needed to tear a deployment down (stop the container/process).
export interface TeardownInput {
  projectName: string;
  env: string;
}

// Restart of a previously deployed environment (after Stop). The version does
// not change — the provider re-runs what was already deployed.
export interface StartInput {
  projectName: string;
  env: string;
  port?: number;
  healthPath?: string;
  // Version that was last deployed (SFTP re-links the release symlink to it).
  version?: string;
  // Command that starts the app for source-based deployments (SSH).
  startCommand?: string;
  // Application port allocated by the platform (see DeployInput.appPort).
  appPort?: number;
}

/**
 * Pluggable deployment adapter. The platform delegates the "where and how"
 * of a deployment to a concrete implementation (Docker, SFTP, SSH).
 * Supporting a new target means implementing this interface.
 */
export interface DeploymentProvider {
  readonly kind: ProviderKind;
  deploy(input: DeployInput): Promise<DeployResult>;
  // Removes the deployment of the given environment; optional.
  teardown?(input: TeardownInput): Promise<void>;
  // Returns the last ~N lines of the running deployment's log; optional.
  logs?(input: TeardownInput): Promise<string>;
  // Removes all local images of the given repository (<registry>/<owner>/<name>:*).
  removeImages?(repo: string): Promise<void>;
  // Suspends a running environment (stops the container/process); the
  // deployed version is kept.
  stop?(input: TeardownInput): Promise<void>;
  // Re-starts a previously deployed (stopped) environment at the same version.
  start?(input: StartInput): Promise<DeployResult>;
}
