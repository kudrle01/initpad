import type { Readable } from 'stream';

/**
 * Durable object storage for verified build artifacts (ADR-059).
 *
 * A provider-neutral facade over an S3-compatible private bucket (MinIO locally,
 * S3 or compatible in the cloud). The stored `.tar` image archive is the source
 * of truth for a build; the local Docker daemon is only a warm cache that can be
 * rehydrated from here. Implementations must never expose objects publicly and
 * must never log credentials or presigned URLs.
 */
export interface ArtifactStore {
  /** False only for the process-memory development fallback. */
  readonly durable: boolean;

  /**
   * Verifies that the configured store and private bucket are reachable.
   * This is a dependency readiness check, not an object-integrity scan.
   */
  checkHealth(): Promise<void>;

  /**
   * Uploads a local file to the given opaque key. Overwrites any existing object
   * at that key (keys embed the content digest, so this is idempotent per build).
   */
  put(
    key: string,
    filePath: string,
    opts?: { contentType?: string; sizeBytes?: number },
  ): Promise<void>;

  /** Object metadata if present, otherwise null. Used to detect a lost cache. */
  head(key: string): Promise<ArtifactObjectHead | null>;

  /** Streams the object down to a local destination path (for rehydration). */
  getToFile(key: string, destPath: string): Promise<void>;

  /**
   * Opens a bounded-identity object as a stream. Callers remain responsible for
   * authenticating the consumer; the store never exposes bucket credentials.
   */
  openRead(key: string): Promise<Readable>;

  /** Removes the object. Idempotent: a missing object is not an error. */
  delete(key: string): Promise<void>;

  /**
   * Short-lived presigned GET URL, for a job/Agent to fetch the object directly
   * without platform credentials. TTL is bounded by config; never logged.
   */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
}

export interface ArtifactObjectHead {
  sizeBytes: number;
}

/** DI token for the configured {@link ArtifactStore}. */
export const ARTIFACT_STORE = Symbol('ARTIFACT_STORE');

/**
 * Derives the opaque, tenant-scoped storage key for an artifact.
 *
 * The key is built only from immutable internal identifiers plus the content
 * digest — never from a user-supplied name or path. Cross-tenant isolation is a
 * consequence of these IDs: two workspaces can never collide on a key, and a key
 * reveals nothing a caller could guess for another tenant. The `.tar` suffix is
 * cosmetic; access control is by bucket privacy, not by key secrecy.
 */
export function artifactObjectKey(input: {
  workspaceId: string;
  projectId: string;
  artifactId: string;
  digest: string;
}): string {
  const parts = [input.workspaceId, input.projectId, input.artifactId, input.digest];
  for (const [i, part] of parts.entries()) {
    if (!part || !part.trim()) {
      throw new Error(`artifactObjectKey: missing key component at position ${i}`);
    }
  }
  const digestSlug = slug(input.digest);
  return [
    'artifacts',
    slug(input.workspaceId),
    slug(input.projectId),
    slug(input.artifactId),
    `${digestSlug}.tar`,
  ].join('/');
}

/** Reduces an identifier to a filesystem/URL-safe slug for use inside a key. */
function slug(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    // Collapse dot runs so no component can carry a `..` traversal sequence.
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!cleaned) throw new Error('artifactObjectKey: component is empty after sanitisation');
  return cleaned;
}
