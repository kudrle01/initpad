# InitPad threat model

## Scope and trust assumptions

The implemented profile is a self-hosted control plane with multiple
workspace-scoped users. Workspace members are not trusted to access another
workspace's metadata, repositories or targets. Members with the appropriate
role are trusted to create application code and register deployment targets;
generated CI code is treated as untrusted. The public internet, repository
content, webhook requests and target endpoints are untrusted.

The API intentionally controls the local Docker daemon to create application
containers. Docker daemon access is host-root-equivalent, so the API container
and its dependencies are part of the trusted computing base. This is acceptable
for the thesis/single-node profile, but not a hard multi-tenant boundary. A
hosted multi-tenant edition must use a remote deployment agent or Kubernetes
API with a restricted service account instead of the host socket. Workspace
RBAC is an application authorization boundary, not a hostile-workload compute
boundary. The implemented Agent performs trust bootstrap, bounded Docker
discovery, heartbeat, a leased outbound job protocol and an allocation-scoped
Docker lifecycle allow-list. Real project delivery remains locked until a
verified artifact and secret-safe configuration contract are attached to it.

## Assets

- Gitea admin token, user PATs, per-repository deploy tokens and webhook secret;
- JWT/OIDC signing keys and encryption key;
- source repositories, OCI images and deployment target credentials;
- Agent enrollment tokens, per-target long-lived credentials and short-lived
  job lease tokens;
- PostgreSQL project/identity state and availability of the host.

## Main controls

- Gitea self-registration is disabled. InitPad owns account creation and lets
  the instance administrator choose open or admin-provisioned registration;
  authentication endpoints are rate-limited.
- Projects and user targets belong to a workspace. Every request resolves an
  authenticated membership server-side; `X-Workspace-Id` is only a selector,
  never proof of access. Viewer/member/maintainer/admin/owner roles separate
  reading, delivery, destructive maintenance and membership administration.
- Personal workspaces cannot accept additional members. Team membership and
  role changes are synchronized to private Gitea repository collaborator
  permissions, with compensating rollback when either side fails.
- Sessions are HTTP-only, SameSite and Secure under HTTPS. OIDC redirects use
  exact origin/path validation and authorization codes are one-time/expiring.
- Sensitive database values use AES-256-GCM. CI callback tokens are random per
  repository and only their SHA-256 hashes are stored by InitPad.
- Gitea webhooks use an HMAC signature (with bearer compatibility) and never put
  secrets in URLs.
- The Actions runner uses a dedicated rootless DinD daemon. It mounts no host
  socket or host workspace and allows no workflow-defined volumes. Concurrency
  is explicitly bounded (one job by default) and its control network is
  separate from PostgreSQL and deployment networks.
- DTO allow-list validation, bounded lengths, workspace policy checks and target
  endpoint/path validation reduce injection, IDOR and resource-exhaustion risk.
- Agent enrollment is workspace-admin-only, short-lived and single-use. The
  database stores only enrollment/credential hashes; the target stores its
  credential atomically as `0600`. Heartbeat is outbound-only and reports a
  bounded Docker capability object, not host or workload inventory.
- Agent jobs are target-scoped, atomically claimed and fenced by a short lease
  whose plaintext token is never persisted or logged. Monotonic progress,
  idempotency keys and idempotent completion make response loss and lease
  reassignment safe. Unknown job kinds are failed without interpreting their
  payload as a command. Lifecycle payloads reject unknown fields and contain no
  command, entrypoint, mount or secret. Docker mutations require matching
  target/allocation/workload labels; foreign name collisions are left intact.
- Agent workloads use immutable image digests, resource/log limits,
  `no-new-privileges`, dropped capabilities plus a small runtime allow-list and
  health-gated replacement. Failed candidates do not enter restart loops;
  diagnostic cleanup preserves images that existed before the job.
- Deployment operations atomically lock one environment. Cancellation is a
  persisted request; stale background work cannot publish over a newer state.
- App containers receive memory/CPU/PID/log limits, dropped capabilities and
  `no-new-privileges`. Platform web/API containers are read-only where possible.
- Dependencies and actions are locked; npm and Composer audits are part of the
  release checks. Versioned database migrations replace schema pushing.

## Residual risks

- API remote-code execution can become host compromise through Docker control.
- The in-memory login rate limiter is per replica; horizontal scale needs Redis
  or an ingress/WAF limiter.
- OIDC codes/tokens are in-memory, so API restart invalidates active SSO flows.
- Registered SSH/SFTP hosts are powerful outbound destinations. In a
  multi-tenant service they require DNS resolution checks, egress policy and
  per-tenant agents; in this single-tenant product the owner is trusted.
- Rootless DinD still requires a privileged outer container. It protects the
  host from ordinary workflow Docker control but is not equivalent to a
  dedicated runner VM.
- Workspace RBAC isolates application data but all deployments still share the
  self-hosted control plane's provider credentials and Docker trust boundary.
  Do not expose this profile as a hostile public SaaS.
- Agent access to a Docker daemon is root-equivalent on that target. A stolen
  Agent credential is target-scoped and revocable, and individual claims now
  use short-lived fencing tokens. Allocation enforcement and a non-shell Docker
  allow-list now exist; production delivery still needs verified artifact
  authorization, secret-safe config delivery, installer signing and an
  independent security review.
- Gitea collaborator synchronization spans two systems and therefore uses
  compensation rather than a distributed transaction. Reconciliation and an
  audit log are required before hosted production use.
- Backups contain credentials. They must be encrypted, stored off-host and
  tested with periodic restore drills.

## Production gates

Before calling InitPad hosted multi-tenant or enterprise-ready: remove the host
Docker socket from the control plane, add production e-mail delivery,
approval policy and complete quota enforcement, reconcile SCM permissions, use
an external secret manager, persist OIDC grants, add centralized audit logs,
metrics and traces, scan images/SBOMs, sign artifacts, enforce network egress
and test disaster recovery.
