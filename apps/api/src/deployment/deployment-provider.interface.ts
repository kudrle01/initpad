import { ProviderKind } from '../domain/types';

// Connection to a user-provided deployment target (typically prod: your own
// server, e.g. a school SFTP host or a VPS over SSH). When absent, the provider
// uses the platform's built-in demo target (fake-vps / fake-sftp).
export interface ProviderConnection {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  // Writable root on the remote (SFTP: web dir; SSH: deploy dir).
  remoteRoot: string;
  // Public URL where the deployed app/site is reachable (used for the health
  // check and shown to the user). The user knows their own server's address.
  publicUrl: string;
}

export interface DeployInput {
  // User target for this deployment (prod); absent → platform demo target.
  connection?: ProviderConnection;
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
  // Public docroot within an application artifact (e.g. 'www' for Nette).
  // Protected layouts publish its contents directly at <publicUrl>/<slug>/.
  webRoot?: string;
  // The SFTP artifact was rearranged into a protected shared-hosting layout:
  // its webRoot is published at <slug>/ and the full app is HTTP-denied under
  // .initpad-app. The provider verifies that protection after upload.
  protectedWebLayout?: boolean;
  // Directories prepared for the remote web runtime after an SFTP upload
  // (framework runtime dirs, e.g. Nette 'temp'/'log').
  writableDirs?: string[];
  // Application port allocated by the platform for source-based deployments
  // on a shared host (SSH). Allocated from the database, so it is unique
  // across all environments.
  appPort?: number;
  // Optional progress reporter — the provider calls it with a short
  // human-readable stage/step (e.g. 'Uploading 340/1200 files') so the platform
  // can surface live deploy progress in the UI.
  onProgress?: (message: string) => void;
}

export interface DeployResult {
  status: 'running' | 'failed';
  url: string;
  // Human-readable failure reason (present when status is 'failed').
  reason?: string;
}

// Result of a target connection test ("Test connection" in the UI).
export interface VerifyResult {
  ok: boolean;
  // Human-readable outcome (what succeeded, or why it failed).
  message: string;
}

// Everything needed to tear a deployment down (stop the container/process).
export interface TeardownInput {
  projectName: string;
  env: string;
  connection?: ProviderConnection;
}

export interface TeardownResult {
  // The public workload is gone, but an external target still contains
  // protected data that needs target-administrator cleanup.
  warning?: string;
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
  // User target for this environment (prod); absent → platform demo target.
  connection?: ProviderConnection;
}

/**
 * Pluggable deployment adapter. The platform delegates the "where and how"
 * of a deployment to a concrete implementation (Docker, SFTP, SSH).
 * Supporting a new target means implementing this interface.
 */
export interface DeploymentProvider {
  readonly kind: ProviderKind;
  deploy(input: DeployInput): Promise<DeployResult>;
  // Tests reachability/credentials of a target without deploying anything.
  // `connection` is absent for built-in targets (verified against local infra).
  verify?(connection?: ProviderConnection): Promise<VerifyResult>;
  // Extracts a directory from a CI-tested image into a local dir, producing an
  // SFTP-uploadable artifact without executing project code in the API.
  extractArtifact?(imageRef: string, srcPath: string, destDir: string): Promise<void>;
  // Imports a provider-verified `docker save` archive into the platform's
  // image store and proves that it contains only the expected immutable tag.
  loadImageArchive?(filePath: string, expectedRef: string): Promise<void>;
  hasImage?(imageRef: string): Promise<boolean>;
  // Removes the deployment of the given environment; optional.
  teardown?(input: TeardownInput): Promise<TeardownResult | void>;
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
