# InitPad threat model

## Scope and trust assumptions

InitPad is a self-hosted single-tenant control plane. Authenticated platform
users are trusted to create application code and register deployment targets;
generated CI code is treated as untrusted. The public internet, repository
content, webhook requests and target endpoints are untrusted.

The API intentionally controls the local Docker daemon to create application
containers. Docker daemon access is host-root-equivalent, so the API container
and its dependencies are part of the trusted computing base. This is acceptable
for the thesis/single-node profile, but not a hard multi-tenant boundary. A
production multi-tenant edition must use a remote deployment agent or
Kubernetes API with a restricted service account instead of the host socket.

## Assets

- Gitea admin token, user PATs, per-repository deploy tokens and webhook secret;
- JWT/OIDC signing keys and encryption key;
- source repositories, OCI images and deployment target credentials;
- PostgreSQL project/identity state and availability of the host.

## Main controls

- Gitea self-registration is disabled; InitPad defaults to first-user
  registration and rate-limits authentication endpoints.
- Sessions are HTTP-only, SameSite and Secure under HTTPS. OIDC redirects use
  exact origin/path validation and authorization codes are one-time/expiring.
- Sensitive database values use AES-256-GCM. CI callback tokens are random per
  repository and only their SHA-256 hashes are stored by InitPad.
- Gitea webhooks use an HMAC signature (with bearer compatibility) and never put
  secrets in URLs.
- The Actions runner uses a dedicated rootless DinD daemon. It mounts no host
  socket or host workspace, allows no workflow-defined volumes and runs one job
  at a time. Its control network is separate from PostgreSQL and deployment
  networks.
- DTO allow-list validation, bounded lengths, ownership checks and target
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
- Backups contain credentials. They must be encrypted, stored off-host and
  tested with periodic restore drills.

## Production gates

Before calling InitPad multi-tenant or enterprise-ready: remove the host Docker
socket, add RBAC/teams and approvals, use an external secret manager, persist
OIDC grants, add centralized audit logs/metrics/traces, scan images/SBOMs, sign
artifacts, enforce network egress and test disaster recovery.
