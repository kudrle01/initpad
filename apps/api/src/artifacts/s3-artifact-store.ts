import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { ArtifactObjectHead, ArtifactStore } from './artifact-store';

export interface S3ArtifactStoreOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * S3-compatible {@link ArtifactStore}. Works against AWS S3 (leave endpoint
 * empty) or a self-hosted MinIO (set endpoint + forcePathStyle). The bucket must
 * be private; this class never sets a public ACL. Presigned URLs and credentials
 * are never logged.
 */
export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: S3ArtifactStoreOptions) {
    if (!opts.bucket) throw new Error('S3ArtifactStore: bucket is required');
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint || undefined,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(
    key: string,
    filePath: string,
    opts?: { contentType?: string; sizeBytes?: number },
  ): Promise<void> {
    const contentLength = opts?.sizeBytes ?? (await stat(filePath)).size;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: contentLength,
        ContentType: opts?.contentType ?? 'application/x-tar',
      }),
    );
  }

  async head(key: string): Promise<ArtifactObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: Number(res.ContentLength ?? 0) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getToFile(key: string, destPath: string): Promise<void> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = res.Body;
    if (!body || !(body instanceof Readable)) {
      throw new Error(`S3ArtifactStore: unexpected empty body for '${key}'`);
    }
    await pipeline(body, createWriteStream(destPath));
  }

  async openRead(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = res.Body;
    if (!body || !(body instanceof Readable)) {
      throw new Error(`S3ArtifactStore: unexpected empty body for '${key}'`);
    }
    return body;
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent: deleting a missing key returns 204.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }
}

/** Recognises S3/MinIO "object does not exist" responses across SDK shapes. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.Code === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}
