import { NodeHttpHandler } from '@smithy/node-http-handler';
import { S3ArtifactStore } from './s3-artifact-store';

type HandlerConfig = { connectionTimeout?: number; requestTimeout?: number };

async function handlerConfig(store: S3ArtifactStore) {
  const client = (store as unknown as { client: { config: { requestHandler: unknown } } }).client;
  const handler = client.config.requestHandler;
  expect(handler).toBeInstanceOf(NodeHttpHandler);
  return (handler as { configProvider: Promise<HandlerConfig> }).configProvider;
}

const BASE = {
  region: 'us-east-1',
  bucket: 'artifacts',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

describe('S3ArtifactStore', () => {
  it('bounds connection setup and socket inactivity of every request', async () => {
    const store = new S3ArtifactStore({
      ...BASE,
      connectionTimeoutMs: 7_000,
      requestTimeoutMs: 90_000,
    });

    await expect(handlerConfig(store)).resolves.toEqual(
      expect.objectContaining({ connectionTimeout: 7_000, requestTimeout: 90_000 }),
    );
  });

  it('uses finite defaults when no limits are configured', async () => {
    await expect(handlerConfig(new S3ArtifactStore(BASE))).resolves.toEqual(
      expect.objectContaining({ connectionTimeout: 10_000, requestTimeout: 120_000 }),
    );
  });
});
