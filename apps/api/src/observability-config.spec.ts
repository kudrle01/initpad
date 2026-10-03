import { readObservabilityConfig } from './observability-config';

describe('readObservabilityConfig', () => {
  it('keeps telemetry disabled without creating a collector dependency', () => {
    expect(readObservabilityConfig({})).toEqual({
      enabled: false,
      endpoint: '',
      serviceName: 'initpad-api',
      metricExportIntervalMs: 60_000,
    });
  });

  it('accepts one explicit internal OTLP endpoint', () => {
    expect(
      readObservabilityConfig({
        INITPAD_OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318/',
        OTEL_SERVICE_NAME: 'initpad-api-canary',
        OTEL_METRIC_EXPORT_INTERVAL: '15000',
      }),
    ).toEqual({
      enabled: true,
      endpoint: 'http://otel-collector:4318',
      serviceName: 'initpad-api-canary',
      metricExportIntervalMs: 15_000,
    });
  });

  it.each([
    [{ INITPAD_OTEL_ENABLED: 'yes' }, 'INITPAD_OTEL_ENABLED'],
    [{ INITPAD_OTEL_ENABLED: 'true' }, 'OTEL_EXPORTER_OTLP_ENDPOINT'],
    [
      {
        INITPAD_OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:secret@collector.example',
      },
      'without credentials',
    ],
    [
      {
        INITPAD_OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=secret',
      },
      'credential-free OTLP endpoint',
    ],
    [
      {
        INITPAD_OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://other.example/v1/traces',
      },
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    ],
    [{ OTEL_SERVICE_NAME: 'InitPad API' }, 'OTEL_SERVICE_NAME'],
    [{ OTEL_METRIC_EXPORT_INTERVAL: '999' }, 'OTEL_METRIC_EXPORT_INTERVAL'],
  ])('rejects an unsafe observability configuration', (env, message) => {
    expect(() => readObservabilityConfig(env)).toThrow(message);
  });
});
