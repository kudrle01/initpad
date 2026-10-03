import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';
import { runtimeInstanceId } from './runtime-instance';

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
const meter = metrics.getMeter('initpad-api-http');
const requestCounter = meter.createCounter('initpad.http.requests', {
  description: 'Completed InitPad HTTP requests',
});
const requestDuration = meter.createHistogram('initpad.http.request.duration', {
  description: 'InitPad HTTP request duration',
  unit: 'ms',
});
export function httpMetricAttributes(method: string | undefined, statusCode: number) {
  return {
    'http.request.method': method ?? 'UNKNOWN',
    'http.response.status_code': statusCode,
    'initpad.http.status_class': statusCode ? `${Math.floor(statusCode / 100)}xx` : 'unknown',
  };
}

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
  trace.getActiveSpan()?.setAttribute('initpad.request.id', requestId);
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-InitPad-Instance', runtimeInstanceId);
  requestStorage.run({ requestId }, () => {
    response.once('finish', () => {
      const path = (request.originalUrl ?? request.url ?? '').split('?', 1)[0];
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const statusCode = response.statusCode ?? 0;
      const attributes = httpMetricAttributes(request.method, statusCode);
      requestCounter.add(1, attributes);
      requestDuration.record(durationMs, attributes);
      if (path.startsWith('/api/health/') && (response.statusCode ?? 200) < 400) return;
      httpLogger.log({
        event: 'http.request.completed',
        requestId,
        method: request.method ?? 'UNKNOWN',
        path,
        statusCode,
        durationMs,
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
