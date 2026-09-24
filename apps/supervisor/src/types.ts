export const SUPERVISOR_VERSION = '0.2.8';

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
  database: {
    migrationMode: 'expand-contract';
    rollback: 'image-compatible';
    backupRequired: true;
  };
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
