export const SUPERVISOR_VERSION = '0.2.35';

export type UpdateOperationStatus = 'accepted' | 'running' | 'succeeded' | 'failed' | 'rolled-back';

export interface UpdateOperation {
  id: string;
  requestId: string;
  fromVersion: string;
  toVersion: string;
  status: UpdateOperationStatus;
  stage: string;
  message: string;
  backupPath: string | null;
  // Set once a contract release was verified; recovery then refuses an
  // image-only rollback after the API stage.
  restoreRequired?: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface SupervisorState {
  schemaVersion: 1;
  currentVersion: string;
  currentImages: Record<'api' | 'web' | 'supervisor', string> | null;
  operation: UpdateOperation | null;
}

export interface PlatformImage {
  name: string;
  digest: string;
  immutableReference: string;
  platforms: string[];
}

export interface PlatformReleaseManifest {
  schemaVersion: 1;
  component: 'initpad-platform';
  version: string;
  source: { repository: string; tag: string; commit: string };
  images: Record<'api' | 'web' | 'supervisor', PlatformImage>;
  compose: { file: 'initpad-release.override.yml'; sha256: string };
  // A contract release ships migrations an older API cannot run against;
  // after its API started, only a database restore returns to the previous
  // release (ADR-183).
  database:
    | { migrationMode: 'expand-contract'; rollback: 'image-compatible'; backupRequired: true }
    | { migrationMode: 'contract'; rollback: 'restore-required'; backupRequired: true };
}

export interface SignedPlatformRelease {
  version: string;
  manifestBase64: string;
  bundle: unknown;
}

export interface UpdatePlan {
  schemaVersion: 1;
  operationId: string;
  release: SignedPlatformRelease;
  createdAt: string;
}
