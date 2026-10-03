# OpenTelemetry Collector boundary

`otel-collector.example.yaml` is a vendor-neutral starting point for the
infrastructure-owned collector. It receives only OTLP/HTTP traces and metrics
from InitPad API replicas, applies memory and batching limits and forwards both
signals to a private backend.

Run the collector on the same private network as the API and set:

```ini
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

The backend endpoint and authorization header are collector secrets:

```ini
INITPAD_OBSERVABILITY_BACKEND_OTLP_ENDPOINT=https://observability.example/otlp
INITPAD_OBSERVABILITY_BACKEND_AUTHORIZATION=Bearer REPLACE
```

Do not put those values in the InitPad `.env` file or commit them. Mount the
reviewed collector configuration read-only and inject its secrets from the
deployment secret manager. API JSON stdout requires the runtime's normal log
collector; OpenTelemetry JavaScript log export is not used while that SDK is
still experimental.

The example deliberately does not choose a storage vendor. Before production,
connect a maintained backend, implement the retention/access/alert policy in
[`docs/OBSERVABILITY.md`](../../docs/OBSERVABILITY.md), and run its staging
acceptance. A collector that merely prints signals is not a production setup.
