import http from 'node:http';
import https from 'node:https';
import type { RequestOptions } from 'node:http';

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface DockerHttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: Buffer | string | AsyncIterable<Uint8Array>;
  headers?: Record<string, string>;
  maxResponseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DockerHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export type DockerTransport = (
  request: DockerHttpRequest,
  dockerHost: string,
) => Promise<DockerHttpResponse>;

function requestOptions(
  request: DockerHttpRequest,
  dockerHost: string,
): { client: typeof http | typeof https; options: RequestOptions } {
  const common: RequestOptions = {
    path: request.path,
    method: request.method,
    headers: request.headers,
  };
  if (dockerHost.startsWith('unix://')) {
    return {
      client: http,
      options: { ...common, socketPath: dockerHost.slice('unix://'.length) },
    };
  }
  const endpoint = new URL(dockerHost.replace(/^tcp:/, 'http:'));
  return {
    client: endpoint.protocol === 'https:' ? https : http,
    options: {
      ...common,
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
    },
  };
}

/** Bounded, abortable transport for the Docker Engine HTTP API. */
export async function dockerHttpRequest(
  input: DockerHttpRequest,
  dockerHost: string,
): Promise<DockerHttpResponse> {
  const body =
    input.body === undefined
      ? undefined
      : isAsyncIterable(input.body)
        ? input.body
        : Buffer.isBuffer(input.body)
          ? input.body
          : Buffer.from(input.body);
  const bufferedBody = body && !isAsyncIterable(body) ? body : undefined;
  const request = {
    ...input,
    headers: {
      ...(bufferedBody ? { 'content-length': String(bufferedBody.length) } : {}),
      ...input.headers,
    },
  };
  const { client, options } = requestOptions(request, dockerHost);
  return new Promise((resolve, reject) => {
    const req = client.request(options, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
          req.destroy(new Error('Docker API response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () =>
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    const abort = () => req.destroy(new Error('Docker API request aborted'));
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) {
      abort();
      return;
    }
    req.setTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, () =>
      req.destroy(new Error('Docker API timed out')),
    );
    req.on('error', reject);
    req.on('close', () => input.signal?.removeEventListener('abort', abort));
    if (body && isAsyncIterable(body)) {
      void writeRequestStream(req, body, input.signal).catch((error) =>
        req.destroy(error as Error),
      );
    } else {
      if (bufferedBody) req.write(bufferedBody);
      req.end();
    }
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value);
}

export async function writeRequestStream(
  request: http.ClientRequest,
  body: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<void> {
  for await (const chunk of body) {
    if (signal?.aborted) throw new Error('Docker API request aborted');
    if (!request.write(Buffer.from(chunk))) {
      await waitForDrain(request, signal);
    }
  }
  request.end();
}

function waitForDrain(request: http.ClientRequest, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      request.removeListener('drain', drained);
      request.removeListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const aborted = () => failed(new Error('Docker API request aborted'));

    request.once('drain', drained);
    request.once('error', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

export function dockerError(response: DockerHttpResponse, action: string): Error {
  let detail = response.body.toString('utf8').trim();
  try {
    const parsed = JSON.parse(detail) as { message?: unknown };
    if (typeof parsed.message === 'string') detail = parsed.message;
  } catch {
    // Docker streaming endpoints may return plain text or JSON lines.
  }
  return new Error(
    `Docker API ${action} returned HTTP ${response.statusCode}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
  );
}
