# Deploying InitPad

One-command install of the whole platform (web, API, PostgreSQL, Gitea,
CI runner, simulated deployment targets). The only prerequisite is Docker
with the compose plugin.

## Local install

```bash
git clone <this repo> && cd initpad/deploy
./install.sh
```

Open http://localhost:8080, register an account and create a project.
The script is idempotent — re-run it anytime; it only fixes what's missing.

What it automates: secret generation, Gitea provisioning without the web
wizard (service account + admin token via CLI), SSO registration (the
platform is Gitea's OIDC sign-in), CI runner registration, database schema
sync and container builds.

## Server install

1. Point two DNS records at the server, e.g. `platform.example.org` and
   `git.example.org`.
2. In `deploy/.env` set:

   ```ini
   INITPAD_PUBLIC_HOST=platform.example.org
   INITPAD_PUBLIC_URL=https://platform.example.org
   INITPAD_GITEA_PUBLIC_URL=https://git.example.org
   INITPAD_REGISTRY_HOST=git.example.org
   INITPAD_DOMAIN=platform.example.org
   INITPAD_GIT_DOMAIN=git.example.org
   ```

3. Run `./install.sh`. Setting `INITPAD_DOMAIN` enables the `server`
   profile — Caddy terminates HTTPS for both domains with automatic
   certificates.
4. Open firewall ports: 80, 443 (platform + git), 8085 and 8090–8189
   (deployed student applications).

## Operations

- **State** lives in two Docker volumes only: `initpad_pgdata` (database)
  and `initpad_gitea-data` (repositories + registry). Back these up.
- **Upgrade**: `git pull && docker compose up -d --build api web`.
- **Logs**: `docker compose logs -f api` (or any other service).
- Do not run this stack and the `infra/` development stack simultaneously —
  they share the compose project name on purpose (CI job containers attach
  to the `initpad_platform` network).

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
