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
boundary.

## Assets

- Gitea admin token, user PATs, per-repository deploy tokens and webhook secret;
- JWT/OIDC signing keys and encryption key;
- source repositories, OCI images and deployment target credentials;
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
- Gitea collaborator synchronization spans two systems and therefore uses
  compensation rather than a distributed transaction. Reconciliation and an
  audit log are required before hosted production use.
- Backups contain credentials. They must be encrypted, stored off-host and
  tested with periodic restore drills.

### Tracked dependency exception

As of 2026-08-03, `npm audit` reports GHSA-qwww-vcr4-c8h2 for the current
React Router release. The upstream advisory states that the issue only affects
applications using the unstable React Server Components APIs. InitPad ships a
static Vite single-page application and defines no RSC server, server actions or
unstable RSC routes, so the vulnerable execution path is absent. The dependency
remains on the latest compatible release instead of being downgraded to a
version with broader navigation and hydration advisories. This exception must
be removed as soon as a patched stable package compatible with the frontend is
published, and the audit must be reviewed again before a public SaaS release.

Reference: https://github.com/advisories/GHSA-qwww-vcr4-c8h2

## Production gates

Before calling InitPad hosted multi-tenant or enterprise-ready: remove the host
Docker socket from the control plane, add production e-mail delivery,
approval policy and complete quota enforcement, reconcile SCM permissions, use
an external secret manager, persist OIDC grants, add centralized audit logs,
metrics and traces, scan images/SBOMs, sign artifacts, enforce network egress
and test disaster recovery.
