import { createReadStream } from 'fs';
import * as tarStream from 'tar-stream';

/**
 * Verifies the *identity* of a Docker image archive (`docker save` tarball)
 * without a Docker daemon (ADR-059).
 *
 * The archive must contain exactly one `manifest.json` describing exactly one
 * image tagged exactly `expectedRef` — nothing more. This is the gate that keeps
 * a CI-produced artifact from smuggling extra images or an unexpected tag into
 * the platform, and it is deliberately daemon-free so the ingest pipeline can run
 * it before loading anything into Docker (or on a control plane with no Docker at
 * all). SHA-256 content integrity is checked separately at download time; this
 * function only asserts the archive's declared identity.
 */
export async function assertImageArchiveIdentity(
  filePath: string,
  expectedRef: string,
): Promise<void> {
  const extract = tarStream.extract();
  let manifest: Buffer | null = null;
  let validationError: Error | null = null;
  let manifestSeen = false;
  let entries = 0;

  extract.on('entry', (header, stream, next) => {
    entries += 1;
    if (entries > 100_000) {
      validationError ??= new Error('Image archive contains too many entries');
      stream.resume();
      stream.on('end', next);
      return;
    }
    if (header.name !== 'manifest.json') {
      stream.resume();
      stream.on('end', next);
      return;
    }
    if (manifestSeen) {
      validationError ??= new Error('Image archive contains duplicate Docker manifests');
      stream.resume();
      stream.on('end', next);
      return;
    }
    manifestSeen = true;
    const chunks: Buffer[] = [];
    let bytes = 0;
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        validationError ??= new Error('Image archive manifest is too large');
        return;
      }
      if (!validationError) chunks.push(Buffer.from(chunk));
    });
    stream.on('end', () => {
      manifest = Buffer.concat(chunks);
      next();
    });
  });

  await new Promise<void>((resolve, reject) => {
    extract.on('finish', resolve);
    extract.on('error', reject);
    const source = createReadStream(filePath);
    source.on('error', reject);
    source.pipe(extract);
  });

  const archiveError = validationError as Error | null;
  if (archiveError) throw archiveError;
  // Assigned by the asynchronous tar entry callback; keep an explicit local so
  // TypeScript does not treat the pre-callback null as a control-flow invariant.
  const manifestBytes = manifest as Buffer | null;
  if (!manifestBytes) throw new Error('Image archive contains no Docker manifest');

  let records: Array<{ RepoTags?: string[] }>;
  try {
    records = JSON.parse(manifestBytes.toString('utf8')) as Array<{ RepoTags?: string[] }>;
  } catch {
    throw new Error('Image archive contains an invalid Docker manifest');
  }
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== 'object')) {
    throw new Error('Image archive contains an invalid Docker manifest');
  }
  const tags = records.flatMap((record) => record.RepoTags ?? []);
  if (tags.some((tag) => typeof tag !== 'string')) {
    throw new Error('Image archive contains an invalid Docker tag');
  }
  if (records.length !== 1 || tags.length !== 1 || tags[0] !== expectedRef) {
    throw new Error(`Image archive must contain exactly the expected tag '${expectedRef}'`);
  }
}
