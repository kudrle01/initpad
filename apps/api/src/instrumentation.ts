import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { runtimeInstanceId } from './common/runtime-instance';
import { readObservabilityConfig } from './observability-config';

const settings = readObservabilityConfig(process.env);

if (settings.enabled) {
  // The exporters honor the standard OTEL_EXPORTER_OTLP_* variables. The
  // validated common endpoint is normalized before they inspect the process.
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = settings.endpoint;
  const sdk = new NodeSDK({
    // Use only the reviewed resource set below. In particular, do not ingest
    // arbitrary OTEL_RESOURCE_ATTRIBUTES from the host environment.
    autoDetectResources: false,
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: settings.serviceName,
        [ATTR_SERVICE_VERSION]: process.env.INITPAD_PLATFORM_VERSION || 'source',
        [ATTR_SERVICE_INSTANCE_ID]: runtimeInstanceId,
      }),
    ),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: settings.metricExportIntervalMs,
      }),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) =>
          (request.url ?? '').split('?', 1)[0].startsWith('/api/health/'),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new RuntimeNodeInstrumentation(),
      new UndiciInstrumentation(),
      new AwsInstrumentation({ suppressInternalInstrumentation: true }),
    ],
  });
  sdk.start();

  const shutdown = () => {
    void sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
