import { isSpanContextValid, trace } from '@opentelemetry/api';

/** Adds searchable trace identity without making telemetry an auth boundary. */
export function activeTraceFields(): { traceId: string; spanId: string } | null {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return null;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}
