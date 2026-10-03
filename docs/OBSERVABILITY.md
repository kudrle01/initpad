# Observability contract

InitPad emits three distinct kinds of operational evidence. Audit events
answer who requested a change, deployment operations describe its durable
state, and telemetry helps an operator locate a runtime failure. Telemetry is
never an authorization or consistency boundary.

## Signals

- The API writes bounded, redacted JSON logs to stdout. A runtime log collector
  should ingest these lines without rewriting `requestId`, `correlationId`,
  `traceId` or `spanId`.
- With `INITPAD_OTEL_ENABLED=true`, every API replica exports traces and metrics
  over OTLP/HTTP to one private OpenTelemetry Collector endpoint.
- Automatic instrumentation covers Node runtime, inbound and outbound HTTP,
  Nest/Express and supported database/client libraries. Health probes are
  excluded from traces; successful probes are also excluded from access logs.
- `initpad.http.requests` and `initpad.http.request.duration` are bounded custom
  metrics. Their attributes contain only method, numeric status and status
  class; raw paths, query strings, workspace IDs and user IDs are deliberately
  absent.
- Every process reports `service.name`, platform `service.version` and a fresh
  `service.instance.id`. The same opaque value appears in the existing
  `X-InitPad-Instance` header, connecting black-box active-active acceptance to
  telemetry without making it an identity credential.

Self-hosted export is disabled by default. Enabling it requires:

```ini
INITPAD_OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=initpad-api
OTEL_METRIC_EXPORT_INTERVAL=60000
```

The endpoint may use HTTP on a private deployment network. Use HTTPS when it
crosses a trust boundary. Credentials, query parameters and fragments are
rejected; vendor authentication belongs on the collector, not in the API
configuration. Collector unavailability must create a telemetry-gap alert but
must not make the application unavailable.

The SaaS Compose contract makes OTLP export mandatory but does not bundle a
backend. The collector and its storage are infrastructure-owned services. A
vendor-neutral starting configuration is in
[`deploy/observability`](../deploy/observability/README.md).

## Retention and access baseline

Before admitting untrusted tenants, the operator records the actual backend
policy and verifies automatic deletion:

| Signal                      |          Default minimum | Access                                              |
| --------------------------- | -----------------------: | --------------------------------------------------- |
| Metrics                     |                  30 days | on-call and platform operators                      |
| Traces                      |                   7 days | on-call and platform operators                      |
| Structured application logs |                  30 days | on-call; security review by explicit grant          |
| Audit events                | product retention policy | workspace-authorized UI and platform administrators |

These are operational defaults, not a reason to retain personal data. Request
or response bodies, cookies, authorization headers, URL credentials and secret
environment values must never be collected. Backend access and policy changes
must themselves be audited.

## Alert baseline

Alert names are stable even if the backend query language differs:

| Alert                     | Initial threshold                                        | First action                                             |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `InitPadApiUnavailable`   | readiness fails for 2 minutes                            | check edge, API replicas and PostgreSQL                  |
| `InitPadHighErrorRate`    | at least 20 requests and more than 2% 5xx for 5 minutes  | group traces by route/status and inspect correlated logs |
| `InitPadHighLatency`      | p95 over 2 seconds for 10 minutes                        | separate database, SCM, S3 and target latency            |
| `InitPadTelemetryGap`     | no telemetry from an expected API instance for 5 minutes | check collector reachability before trusting dashboards  |
| `InitPadMailOutboxFailed` | any terminal `mail.outbox.failed` event                  | inspect relay health without printing encrypted payloads |
| `InitPadLeaderChurn`      | more than 3 leader takeovers in 15 minutes               | inspect database connectivity and replica restarts       |

Tune thresholds from staging measurements rather than silently weakening the
initial policy in production.

## Incident sequence

1. Record the alert time, affected public origin and release version. Do not
   copy secrets or request bodies into the incident record.
2. Use `requestId` or `correlationId` from the UI/API response to locate the
   structured log. Follow its `traceId` to the trace backend.
3. Determine whether the failure is edge, API, PostgreSQL, object storage, SCM
   or deployment-target related. Check at least two API instance IDs before
   calling an active-active incident replica-specific.
4. Prefer a documented rollback or target disconnect over manual database
   edits. Preserve audit and deployment-operation history.
5. After recovery, record the detection gap, customer impact, remediation and
   whether the alert/retention policy needs a reviewed change.

## Staging acceptance

The observability gate is complete only after a live staging run proves:

1. two API replicas emit distinct `service.instance.id` values;
2. one request is connected across access log and trace by `traceId`;
3. request counters and duration histograms arrive without raw URL cardinality;
4. stopping the collector leaves API readiness healthy and fires the telemetry
   gap alert;
5. restarting it resumes export without an API restart; and
6. expired test logs, traces and metrics are actually deleted by the backend.

Configuration and unit tests establish the export boundary; they do not count
as this live production evidence.
