# Public SaaS staging acceptance

This procedure is for a disposable public-SaaS staging deployment. It verifies
the separate `api + web` profile against external PostgreSQL, private
S3-compatible storage, projected secret files and the real public HTTPS edge.
It does not turn a local self-hosted installation into SaaS and it must not be
used as a first restore test on production data.

## Preconditions

- Deploy `saas.compose.yml` with immutable release images.
- Project each secret-manager value into the path configured by the matching
  `*_FILE` entry in the deployment env file.
- Keep the bucket private. The credentials need the same Head/Get/Put/Delete
  operations as InitPad's artifact lifecycle.
- Configure a trusted public HTTPS origin and start both `api` and `web` behind
  the intended edge proxy.
- Keep the staging control plane quiescent before scaling API replicas: no
  provisioning, deployment, promotion, rollback or target mutation may be in
  progress. Background lifecycle has a database-elected leader, but process-bound
  project operations do not yet have active-active execution fencing.
- Prepare provider-native backup and restore procedures for the whole InitPad
  PostgreSQL database and the complete artifact bucket.

The helper never sources the env file. Secret files are mounted read-only and
loaded only inside the short-lived API probe container. Output contains a
bounded status, migration count and result type, never credentials, endpoints,
presigned URLs or object bodies.

## Dependency and public-edge check

Run from `deploy/` on the staging control-plane host:

```bash
./saas-acceptance.sh dependencies /secure/runtime/initpad-saas.env
```

This requires healthy long-running API and web containers, verifies the real
public `/api/health/ready` endpoint over trusted HTTPS, reads the Prisma
migration state and performs an S3 write/read/hash/delete round-trip.

## Bounded public-edge load check

This check measures authenticated read paths through the real HTTPS edge and
proves that at least two distinct API processes answered. It is deliberately a
quiescent staging gate, not evidence that concurrent project mutations are safe
on an active-active control plane.

First confirm in the UI that no project operation is active. Then scale the API
and recreate the web edge so its upstream resolution includes both replicas:

```bash
docker compose --env-file /secure/runtime/initpad-saas.env \
  -f saas.compose.yml up -d --scale api=2 api
docker compose --env-file /secure/runtime/initpad-saas.env \
  -f saas.compose.yml up -d --force-recreate web

./saas-acceptance.sh load /secure/runtime/initpad-saas.env
```

The probe creates and removes an isolated account/workspace fixture. It refuses
to run while a provisioning or deployment operation is active, requires at
least 300 completed requests, two answering API process IDs, at most 1% errors
and p95 latency at most 1000 ms. The bounded defaults can be adjusted for a
reviewed staging capacity plan with:

- `INITPAD_LOAD_ACCEPTANCE_DURATION_SECONDS`
- `INITPAD_LOAD_ACCEPTANCE_CONCURRENCY`
- `INITPAD_LOAD_ACCEPTANCE_URL` (only when the tested edge differs from the
  configured public origin)
- `INITPAD_LOAD_ACCEPTANCE_MIN_REQUESTS`
- `INITPAD_LOAD_ACCEPTANCE_MIN_INSTANCES`
- `INITPAD_LOAD_ACCEPTANCE_MAX_P95_MS`
- `INITPAD_LOAD_ACCEPTANCE_MAX_ERROR_RATE`

Do not leave more than one public API replica serving mutating production
traffic until the deployment execution-fencing gate is completed.

## SMTP outage and retry drill

Use an unused staging inbox or alias. The drill stores only an opaque UUID in
its local checkpoint; the recipient and credentials are not written to the
report.

1. Block outbound SMTP for every API replica at the provider firewall or
   staging egress policy. Do not merely stop one replica.
2. Prove that the API remains ready and the encrypted outbox row becomes a
   retry instead of being lost:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
   INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT=unused-staging-alias@example.org \
     ./saas-acceptance.sh smtp-outage-before /secure/runtime/initpad-saas.env
   ```

3. Restore SMTP egress for every replica and prove that the retry is delivered
   and its encrypted payload erased:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
   INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT=unused-staging-alias@example.org \
     ./saas-acceptance.sh smtp-outage-after /secure/runtime/initpad-saas.env
   ```

If the drill is aborted, restore SMTP first and remove only its isolated
fixture with `smtp-outage-cleanup`. A successful command appends bounded
evidence to `.runtime/saas-acceptance/results.tsv`.

## External backup and restore drill

The drill adds isolated markers in the `initpad_acceptance` PostgreSQL schema
and under the bucket prefix `acceptance/recovery/`. Successful verification
removes both markers and the temporary schema. A failed verification preserves
them for diagnosis.

1. Create the baseline markers:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh before-backup /secure/runtime/initpad-saas.env
   ```

2. Back up both external services using the reviewed provider procedure. The
   database and bucket checkpoints must be taken after step 1 and before step 3.

3. Create post-backup markers:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh after-backup /secure/runtime/initpad-saas.env
   ```

4. Restore PostgreSQL and the artifact bucket from the backups created in step
   2. Restart the control plane and wait for API and web to become healthy.

5. Prove that both services returned to the same point in time:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh after-restore /secure/runtime/initpad-saas.env
   ```

The last command succeeds only when both baseline markers exist and both
post-backup markers are absent in PostgreSQL and S3. Evidence is appended to
`.runtime/saas-acceptance/results.tsv`, which is local runtime data and must not
be committed.

Passing this helper proves only the commands that were actually run against the
configured staging deployment. GitHub OAuth/App, Agent deployment, tenant
isolation, WAF/egress, observability and active-active mutation scheduling
remain separate gates.
