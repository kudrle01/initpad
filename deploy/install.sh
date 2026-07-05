#!/usr/bin/env bash
# InitPad one-command installer.
#
#   ./install.sh            local install  → http://localhost:8080
#   (set INITPAD_DOMAIN + INITPAD_GIT_DOMAIN in deploy/.env first for a
#    server install with automatic HTTPS)
#
# Idempotent: safe to re-run. Requires Docker with the compose plugin.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose"
say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker is not installed (https://docs.docker.com/get-docker/)."
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."

# ---- 1. configuration + secrets --------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
fi

# Replace every __GENERATE__ placeholder with a random secret.
while grep -q '__GENERATE__' .env; do
  secret=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  tmp=$(mktemp)
  awk -v s="$secret" '!done && /__GENERATE__/ { sub(/__GENERATE__/, s); done=1 } { print }' .env > "$tmp"
  mv "$tmp" .env
done
say "Secrets are in place"

get_env() { awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env; }
set_env() {
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {$0=k"="v; done=1} {print} END{if(!done) print k"="v}' .env > "$tmp"
  mv "$tmp" .env
}

BOT_USER=$(get_env INITPAD_BOT_USER); BOT_USER=${BOT_USER:-initpad-bot}
BOT_PASSWORD=$(get_env INITPAD_BOT_PASSWORD)
OIDC_SECRET=$(get_env INITPAD_OIDC_CLIENT_SECRET)
DOMAIN=$(get_env INITPAD_DOMAIN || true)

# ---- 2. core services -------------------------------------------------------
say "Starting core services (postgres, gitea, deployment targets)"
$COMPOSE up -d postgres gitea fake-vps fake-sftp static-web

say "Waiting for Gitea to become healthy"
for i in $(seq 1 60); do
  state=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q gitea)" 2>/dev/null || echo starting)
  [ "$state" = healthy ] && break
  sleep 2
  [ "$i" = 60 ] && fail "Gitea did not become healthy — check: docker compose logs gitea"
done

# The gitea CLI needs the config path and must run as the 'git' user.
GITEA_CONF=$($COMPOSE exec -T gitea sh -c \
  'test -f /data/gitea/conf/app.ini && echo /data/gitea/conf/app.ini || find /data -name app.ini 2>/dev/null | head -1' | tr -d '\r\n')
[ -n "$GITEA_CONF" ] || fail "Gitea app.ini not found."
GITEA_WORK=$(dirname "$(dirname "$GITEA_CONF")")
gitea_cli() { $COMPOSE exec -T -u git gitea gitea --work-path "$GITEA_WORK" --config "$GITEA_CONF" "$@"; }

# ---- 3. bootstrap: bot account, tokens, SSO, runner -------------------------
if gitea_cli admin user list 2>/dev/null | awk '{print $2}' | grep -qx "$BOT_USER"; then
  say "Service account '$BOT_USER' already exists"
else
  say "Creating service account '$BOT_USER'"
  gitea_cli admin user create --admin --username "$BOT_USER" \
    --password "$BOT_PASSWORD" --email "bot@initpad.local" \
    --must-change-password=false >/dev/null
fi

if [ -z "$(get_env INITPAD_GITEA_TOKEN)" ]; then
  say "Issuing admin access token"
  out=$(gitea_cli admin user generate-access-token --username "$BOT_USER" \
    --token-name "initpad-$(date +%s)" --scopes all 2>&1)
  token=$(printf '%s\n' "$out" | grep -oE '[0-9a-f]{40}' | tail -1)
  [ -n "$token" ] || fail "Could not parse the access token. Output: $out"
  set_env INITPAD_GITEA_TOKEN "$token"
else
  say "Admin access token already configured"
fi

if gitea_cli admin auth list 2>/dev/null | grep -q initpad-sso; then
  say "SSO authentication source already registered"
else
  say "Registering the platform as Gitea's OIDC sign-in (SSO)"
  gitea_cli admin auth add-oauth --name initpad-sso --provider openidConnect \
    --key gitea --secret "$OIDC_SECRET" \
    --auto-discover-url "http://api:3000/api/.well-known/openid-configuration" >/dev/null
fi

if [ -z "$(get_env INITPAD_RUNNER_TOKEN)" ]; then
  say "Generating CI runner registration token"
  out=$(gitea_cli actions generate-runner-token 2>&1)
  rtoken=$(printf '%s\n' "$out" | grep -E '^[A-Za-z0-9]{30,}$' | tail -1)
  [ -n "$rtoken" ] || fail "Could not parse the runner token. Output: $out"
  set_env INITPAD_RUNNER_TOKEN "$rtoken"
else
  say "Runner token already configured"
fi

# ---- 4. platform + runner (+ optional HTTPS proxy) ---------------------------
say "Building and starting the platform (api, web) — first build takes a few minutes"
$COMPOSE up -d --build api web
$COMPOSE --profile runner up -d act_runner
if [ -n "${DOMAIN:-}" ]; then
  say "Starting Caddy reverse proxy for https://$DOMAIN"
  $COMPOSE --profile server up -d caddy
fi

# ---- 5. summary --------------------------------------------------------------
PUBLIC_URL=$(get_env INITPAD_PUBLIC_URL); PUBLIC_URL=${PUBLIC_URL:-http://localhost:8080}
GITEA_URL=$(get_env INITPAD_GITEA_PUBLIC_URL); GITEA_URL=${GITEA_URL:-http://localhost:3001}
cat <<MSG

  ✔ InitPad is running.

    Platform   ${PUBLIC_URL}
    Gitea      ${GITEA_URL}   (admin: ${BOT_USER} / password in deploy/.env)

  Create an account in the web UI and start your first project.
  Re-run ./install.sh anytime — it only fixes what is missing.
MSG
