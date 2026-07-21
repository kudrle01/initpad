import { Logger, Module } from '@nestjs/common';

import { artifactStoreConfigured, config } from '../config';
import { ARTIFACT_STORE } from './artifact-store';
import { InMemoryArtifactStore } from './in-memory-artifact-store';
import { S3ArtifactStore } from './s3-artifact-store';

/**
 * Provides the configured {@link ArtifactStore} (ADR-059).
 *
 * When an S3/MinIO bucket is configured, a real {@link S3ArtifactStore} is used.
 * Otherwise (self-hosted, no bucket) the process falls back to an in-memory store
 * and the local Docker daemon remains the effective cache. The SaaS edition never
 * reaches the fallback: validateConfig refuses to start without a real store.
 */
@Module({
  providers: [
    {
      provide: ARTIFACT_STORE,
      useFactory: () => {
        const log = new Logger('ArtifactStore');
        if (artifactStoreConfigured()) {
          const s = config.artifactStore;
          log.log(
            `Using S3 artifact store (bucket=${s.bucket}, endpoint=${s.endpoint || 'aws-default'})`,
          );
          return new S3ArtifactStore({
            endpoint: s.endpoint,
            region: s.region,
            bucket: s.bucket,
            accessKeyId: s.accessKeyId,
            secretAccessKey: s.secretAccessKey,
            forcePathStyle: s.forcePathStyle,
          });
        }
        log.warn(
          'No artifact bucket configured; using in-memory store. Built images survive ' +
            'only in the local Docker daemon and are lost on restart.',
        );
        return new InMemoryArtifactStore();
      },
    },
  ],
  exports: [ARTIFACT_STORE],
})
export class ArtifactsModule {}
