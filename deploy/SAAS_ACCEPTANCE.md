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

Passing this helper proves the configured staging dependencies and recovery
procedure. GitHub OAuth/App, Agent deployment, tenant isolation, WAF/egress,
observability and load acceptance remain separate gates.
