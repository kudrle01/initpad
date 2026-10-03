export interface ObservabilityConfig {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
  metricExportIntervalMs: number;
}

type Environment = Record<string, string | undefined>;

/**
 * Parses the deliberately small OTLP contract used by the API. Export is
 * opt-in so a self-hosted install never acquires a hidden collector
 * dependency. Signal-specific paths and authentication belong at the trusted
 * collector, not in application logs or public configuration.
 */
export function readObservabilityConfig(env: Environment): ObservabilityConfig {
  const rawEnabled = env.INITPAD_OTEL_ENABLED?.trim() || 'false';
  if (!['true', 'false'].includes(rawEnabled)) {
    throw new Error('INITPAD_OTEL_ENABLED must be true or false');
  }
  const enabled = rawEnabled === 'true';
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || '';
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || 'initpad-api';
  const metricExportIntervalMs = Number(env.OTEL_METRIC_EXPORT_INTERVAL || 60_000);

  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(serviceName)) {
    throw new Error('OTEL_SERVICE_NAME must be a lowercase service identifier');
  }
  if (
    !Number.isInteger(metricExportIntervalMs) ||
    metricExportIntervalMs < 1_000 ||
    metricExportIntervalMs > 300_000
  ) {
    throw new Error('OTEL_METRIC_EXPORT_INTERVAL must be between 1000 and 300000 milliseconds');
  }
  if (!enabled) return { enabled, endpoint: '', serviceName, metricExportIntervalMs };
  if (!endpoint) {
    throw new Error('INITPAD_OTEL_ENABLED requires OTEL_EXPORTER_OTLP_ENDPOINT');
  }
  const forbiddenOverrides = [
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  ].filter((name) => env[name]?.trim());
  if (forbiddenOverrides.length) {
    throw new Error(
      `InitPad accepts only the common credential-free OTLP endpoint; remove ${forbiddenOverrides.join(', ')}`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid HTTP(S) URL');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'OTEL_EXPORTER_OTLP_ENDPOINT must be an HTTP(S) URL without credentials, query or fragment',
    );
  }
  return {
    enabled,
    endpoint: parsed.toString().replace(/\/$/, ''),
    serviceName,
    metricExportIntervalMs,
  };
}
