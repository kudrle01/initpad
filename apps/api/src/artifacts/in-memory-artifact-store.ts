import { promises as fs } from 'fs';
import { Readable } from 'stream';

import { ArtifactObjectHead, ArtifactStore } from './artifact-store';

/**
 * In-memory {@link ArtifactStore} for tests and the self-hosted fallback where no
 * S3-compatible bucket is configured. Objects live in a Map and are lost on
 * restart — acceptable only because the self-hosted single host keeps the built
 * image in its local Docker daemon as well. The SaaS edition refuses to start
 * without a real store (see validateConfig), so this is never its source of truth.
 */
export class InMemoryArtifactStore implements ArtifactStore {
  readonly durable = false;
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, filePath: string): Promise<void> {
    this.objects.set(key, await fs.readFile(filePath));
  }

  async head(key: string): Promise<ArtifactObjectHead | null> {
    const buf = this.objects.get(key);
    return buf ? { sizeBytes: buf.length } : null;
  }

  async getToFile(key: string, destPath: string): Promise<void> {
    const buf = this.objects.get(key);
    if (!buf) throw new Error(`ArtifactStore: object '${key}' not found`);
    await fs.writeFile(destPath, buf);
  }

  async openRead(key: string): Promise<Readable> {
    const buf = this.objects.get(key);
    if (!buf) throw new Error(`ArtifactStore: object '${key}' not found`);
    return Readable.from(buf);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return `memory://artifact/${encodeURIComponent(key)}?ttl=${ttlSeconds}`;
  }

  /** Test helper: whether a key currently holds an object. */
  has(key: string): boolean {
    return this.objects.has(key);
  }
}
