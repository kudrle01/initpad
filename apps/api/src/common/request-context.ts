import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

export interface RequestContext {
  requestId: string;
}

interface RequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
}

interface ResponseLike {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  once(event: 'finish', listener: () => void): void;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();
const httpLogger = new Logger('HttpRequest');

/**
 * A server-generated ID is used deliberately. An untrusted caller cannot
 * choose a value that collides with another tenant's diagnostic trail.
 */
export function requestContextMiddleware(
  request: RequestLike,
  response: ResponseLike,
  next: () => void,
): void {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  response.setHeader('X-Request-Id', requestId);
  requestStorage.run({ requestId }, () => {
    response.once('finish', () => {
      const path = (request.originalUrl ?? request.url ?? '').split('?', 1)[0];
      if (path.startsWith('/api/health/') && (response.statusCode ?? 200) < 400) return;
      httpLogger.log({
        event: 'http.request.completed',
        requestId,
        method: request.method ?? 'UNKNOWN',
        path,
        statusCode: response.statusCode ?? 0,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      });
    });
    next();
  });
}

export function currentRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

/** One stable workflow ID, seeded by the initiating request when available. */
export function newCorrelationId(): string {
  return currentRequestId() ?? randomUUID();
}
