# Deploying InitPad

One-command install of the whole platform (web, API, PostgreSQL, Gitea,
CI runner, simulated deployment targets). The only prerequisite is Docker
with the compose plugin.

## Local install

```bash
git clone <this repo> && cd initpad/deploy
./install.sh
```

Open http://localhost:8080, create the initial account and then create a project.
The script is idempotent — re-run it anytime; it only fixes what's missing.

It also selects the reviewed Agent release from `agent-release.env`. To attach
a Docker server, create its target in **Infrastructure**, generate an enrollment
and run the displayed checksum-verified installer command on that server. There
is intentionally no prerequisite host command named `initpad-agent`, no
Makefile and no repository checkout on the target; the installer only requires
Docker and stores the Agent identity outside its replaceable container.

The bundled S3-compatible object store is a pinned legacy MinIO binary for
local evaluation and trusted single-node installations. It is not the
recommended public-production storage boundary: configure the
`INITPAD_ARTIFACT_S3_*` variables for a separately maintained S3-compatible
service before exposing InitPad publicly. See the production rationale in
[OPERATIONS.md](./OPERATIONS.md#object-storage-produkční-hranice).

What it automates: secret generation, Gitea provisioning without the web
wizard (service account + admin token via CLI), SSO registration (the
platform is Gitea's OIDC sign-in), isolated CI runner registration, versioned
database migrations and container builds.

## Server install

1. Point two DNS records at the server, e.g. `platform.example.org` and
   `git.example.org`.
2. In `deploy/.env` set:

   ```ini
   INITPAD_PUBLIC_URL=https://platform.example.org
   INITPAD_GITEA_PUBLIC_URL=https://git.example.org
   INITPAD_REGISTRY_HOST=git.example.org
   INITPAD_DOMAIN=platform.example.org
   INITPAD_GIT_DOMAIN=git.example.org
   ```

   Built-in application links automatically use the hostname from
   `INITPAD_PUBLIC_URL`. Only a split topology where apps intentionally use a
   different hostname sets `INITPAD_DEPLOY_PUBLIC_HOST`.

   Direct-port deployments bind to `127.0.0.1` by default. Prefer the managed
   gateway for stable HTTPS application addresses. If trusted LAN clients must
   access the random direct ports, explicitly set
   `INITPAD_DEPLOY_BIND_ADDRESS=0.0.0.0` and restrict their firewall range to
   that LAN; changing the bind address alone is not an access-control policy.

3. Run `./install.sh`. Setting `INITPAD_DOMAIN` enables the `server`
   profile — Caddy terminates HTTPS for both domains with automatic
   certificates.
4. Open firewall ports 80 and 443 for the platform, Git and managed gateway.
   Open the configured direct-port range only when the preceding explicit LAN
   mode is required, and only to trusted source networks.

For a reproducible self-hosted verification on Windows + VirtualBox, follow
[SELF_HOSTED_ACCEPTANCE.md](./SELF_HOSTED_ACCEPTANCE.md). It covers a bridged
Ubuntu VM, two-workspace tenant isolation, all PHP variants, backup/restore and
delete/recreate. Agent enrollment and heartbeat use the separate isolated lab in
[apps/agent/README.md](../apps/agent/README.md); neither procedure is a complete
public SaaS delivery test yet.

## Operations

- **Backup**: run `./backup.sh /secure/path/initpad-backup`. It creates a
  consistent checkpoint by briefly stopping writers, dumping PostgreSQL,
  archiving Gitea, MinIO artifacts, API/Supervisor data, the active signed
  release descriptor, published static files, optional Caddy data and runner
  registration, and copying `.env`. Services that were
  running are restarted even when the backup fails. The backup contains
  credentials; encrypt it and keep an off-host copy.
- **Restore drill**: run `./restore.sh <backup-directory>` on a disposable
  installation. It verifies checksums, stops every profile, restores the
  backed-up `.env`, database and inactive volumes, and then starts the base
  stack, runner and configured HTTPS profile. Always test this on a disposable
  host before relying on a backup.
- **Platform update**: a platform administrator uses **Instance administration
  → Platform updates**. InitPad accepts only the newest manifest signed by the
  exact tagged release workflow, backs up and verifies PostgreSQL, switches
  digest-pinned API/web/Supervisor images one at a time and restores the prior
  release when readiness fails. The selected release is persisted in
  `.runtime/platform-update`, so `docker compose up` and `./install.sh` do not
  silently replace it with a source build.
- **Source installation**: when no signed release is active, `git pull &&
  ./install.sh` rebuilds the checked-out API, web and Supervisor. Once a signed
  release is installed, a source pull updates operating files but preserves the
  installed images; use the release UI for the next platform version.
- **Recovery / air-gap**: download one platform release directory, verify it on
  the server and run its `initpad-install-release.sh --project-root
  /absolute/path/to/initpad`. This explicit fallback additionally requires
  Cosign and creates a complete pre-update backup.
- **Agent release**: `./install.sh` fills an empty release pair from
  `agent-release.env`. It preserves a complete explicit pair, so a local pin or
  rollback is never replaced silently. Use `./install.sh --update-agent-release`
  to explicitly adopt the current reviewed release and restart the platform
  with that exact version and immutable digest. A half-configured or mutable
  pair fails before the platform starts unless the explicit update repairs it.
- **Logs**: `docker compose logs -f api` (or any other service).
- Do not run this stack and the `infra/` development stack simultaneously;
  they intentionally share the compose project name.

## Troubleshooting

- **"database volume was initialized with a different password"** — you have
  an older `pgdata` volume but a regenerated `.env`. Fresh start:
  `docker compose down -v && rm .env && ./install.sh` (wipes all platform
  data), or set `INITPAD_DB_PASSWORD` back to the original value.
- **SSO registration fails with "no such host: api"** — the API container is
  not running; re-run `./install.sh` (it registers SSO only after the API is
  healthy).
- **fake-sftp platform warning on Apple Silicon** — the image is amd64-only
  and runs via emulation; the compose file declares `platform: linux/amd64`
  to make this explicit.
- **`initpad-agent: command not found`** — do not install or invoke a host CLI.
  Re-run `./install.sh` on the InitPad control-plane host, reopen **Manage
  Agent**, and copy its complete `curl ... && sudo sh ...` command to the target
  Docker server.
