#!/usr/bin/env bash
# InitPad one-command installer.
#
#   ./install.sh            local install  → http://localhost:8080
#   (set INITPAD_DOMAIN + INITPAD_GIT_DOMAIN in deploy/.env first for a
#    server install with automatic HTTPS)
#
# Idempotent: safe to re-run. Requires Docker with the compose plugin.
# Fully fresh start: docker compose down -v && rm .env && ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose"
say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
random_secret() {
  openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

command -v docker >/dev/null || fail "Docker is not installed (https://docs.docker.com/get-docker/)."
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."

# ---- 1. configuration + secrets --------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
fi
chmod 600 .env

# Replace every __GENERATE__ placeholder with a random secret.
while grep -q '__GENERATE__' .env; do
  secret=$(random_secret)
  tmp=$(mktemp)
  awk -v s="$secret" '!done && /__GENERATE__/ { sub(/__GENERATE__/, s); done=1 } { print }' .env > "$tmp"
  mv "$tmp" .env
  chmod 600 .env
done
say "Secrets are in place"

get_env() { awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env; }
set_env() {
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {$0=k"="v; done=1} {print} END{if(!done) print k"="v}' .env > "$tmp"
  mv "$tmp" .env
  chmod 600 .env
}

# Upgrade existing installations from the former global CI token. It is now
# used only for the Gitea system webhook; repository CI credentials are
# rotated independently by the API on startup.
if [ -z "$(get_env INITPAD_SCM_WEBHOOK_TOKEN)" ]; then
  legacy=$(get_env INITPAD_CI_DEPLOY_TOKEN)
  if [ -n "$legacy" ]; then
    set_env INITPAD_SCM_WEBHOOK_TOKEN "$legacy"
  else
    set_env INITPAD_SCM_WEBHOOK_TOKEN "$(random_secret)"
  fi
fi
if [ -z "$(get_env INITPAD_REGISTRATION_MODE)" ]; then
  set_env INITPAD_REGISTRATION_MODE admin-provisioned
fi
# Local upgrades use a dedicated .localhost hostname so browsers resolve it
# to loopback while isolated CI jobs map the same name to their gateway.
if [ "$(get_env INITPAD_GITEA_PUBLIC_URL)" = "http://localhost:3001" ]; then
  set_env INITPAD_GITEA_PUBLIC_URL http://gitea.localhost:3001
fi
# The host daemon pulls from the host-published registry. A literal IPv4
# loopback is portable across Docker Desktop and plain Linux; *.localhost can
# resolve to ::1 on Fedora even when the published port only accepts IPv4.
registry_host=$(get_env INITPAD_REGISTRY_HOST)
case "$registry_host" in
  localhost:*|gitea.localhost:*)
    set_env INITPAD_REGISTRY_HOST "127.0.0.1:${registry_host##*:}"
    ;;
esac
# CI jobs cannot use *.localhost: glibc gives the reserved suffix an IPv6
# loopback result before Docker's host mapping. Local jobs use the explicit
# host gateway; a server install uses its real public Git hostname.
if [ -z "$(get_env INITPAD_GITEA_RUNNER_URL)" ]; then
  public_gitea=$(get_env INITPAD_GITEA_PUBLIC_URL)
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  case "$public_gitea" in
    http://gitea.localhost:*|http://localhost:*)
      set_env INITPAD_GITEA_RUNNER_URL "http://host.docker.internal:$gitea_port"
      ;;
    *) set_env INITPAD_GITEA_RUNNER_URL "$public_gitea" ;;
  esac
fi
if [ -z "$(get_env INITPAD_CI_REGISTRY_HOST)" ]; then
  registry_host=$(get_env INITPAD_REGISTRY_HOST)
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  case "$registry_host" in
    127.0.0.1:*|gitea.localhost:*|localhost:*)
      set_env INITPAD_CI_REGISTRY_HOST "host.docker.internal:$gitea_port"
      ;;
    *) set_env INITPAD_CI_REGISTRY_HOST "$registry_host" ;;
  esac
fi
# act_runner reads capacity only from YAML and does not interpolate environment
# variables there. Render the validated runtime config before any runner
# migration or startup command asks Compose to mount it.
./render-runner-config.sh
runner_config_changed=no
[ -f .runtime/runner-config.changed ] && runner_config_changed=yes
wait_healthy() { # <service> [attempts]
  local svc=$1 tries=${2:-60} cid state
  for i in $(seq 1 "$tries"); do
    cid=$($COMPOSE ps -q "$svc" 2>/dev/null || true)
    state=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  fail "$svc did not become healthy — check: docker compose logs $svc"
}

# act_runner persists the instance URL in /data/.runner. Changing the Compose
# environment alone therefore does not repair existing installations: checkout
# jobs would keep receiving the old internal-only `http://gitea:3000` address.
# Rotate the runner identity when its stored address differs. The exact old DB
# row is removed while Gitea is stopped, which also invalidates the old runner
# authentication token; no credential is ever printed by this migration.
rotate_runner_if_address_changed() {
  local desired state stored runner_id runner_name deleted
  desired=$(get_env INITPAD_GITEA_RUNNER_URL)
  desired=${desired:-http://host.docker.internal:3001}
  desired=${desired%/}

  state=$($COMPOSE --profile runner run --rm --no-deps --entrypoint sh act_runner -c \
    "test ! -f /data/.runner || sed -n \
      's/.*\"id\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/id=\1/p;
       s/.*\"name\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/name=\1/p;
       s/.*\"address\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/address=\1/p' \
      /data/.runner" 2>/dev/null || true)
  stored=$(printf '%s\n' "$state" | awk -F= '$1=="address" {sub(/^address=/, ""); print; exit}')
  stored=${stored%/}
  [ -z "$stored" ] && return 0
  [ "$stored" = "$desired" ] && return 0

  runner_id=$(printf '%s\n' "$state" | awk -F= '$1=="id" {print $2; exit}')
  runner_name=$(printf '%s\n' "$state" | awk -F= '$1=="name" {sub(/^name=/, ""); print; exit}')
  case "$runner_id" in ''|*[!0-9]*) fail "Stored CI runner id is invalid; refusing an unsafe rotation.";; esac
  [ "$runner_name" = initpad-runner ] || \
    fail "Stored CI runner name is unexpected; remove it manually before continuing."

  say "Rotating CI runner registration for reachable checkout URL"
  $COMPOSE stop act_runner api gitea >/dev/null
  deleted=$($COMPOSE run --rm --no-deps -T -u git --entrypoint sqlite3 gitea \
    /data/gitea/gitea.db \
    "BEGIN IMMEDIATE; DELETE FROM action_runner WHERE id=$runner_id AND name='initpad-runner'; SELECT changes(); COMMIT;" \
    | tr -d '\r' | tail -1)
  case "$deleted" in 0|1) ;; *)
    $COMPOSE up -d gitea api >/dev/null 2>&1 || true
    fail "Could not invalidate the previous CI runner registration."
  esac
  $COMPOSE --profile runner run --rm --no-deps --entrypoint sh act_runner \
    -c 'rm -f /data/.runner'
  $COMPOSE up -d gitea
  wait_healthy gitea 60
  $COMPOSE up -d api
  wait_healthy api 60
}

BOT_USER=$(get_env INITPAD_BOT_USER); BOT_USER=${BOT_USER:-initpad-bot}
BOT_PASSWORD=$(get_env INITPAD_BOT_PASSWORD)
OIDC_SECRET=$(get_env INITPAD_OIDC_CLIENT_SECRET)
DB_PASSWORD=$(get_env INITPAD_DB_PASSWORD)
DOMAIN=$(get_env INITPAD_DOMAIN || true)

# ---- 2. core services -------------------------------------------------------
say "Starting core services (postgres, gitea, deployment targets)"
$COMPOSE up -d postgres gitea fake-vps fake-sftp static-web

say "Waiting for PostgreSQL"
wait_healthy postgres 30
# A pre-existing database volume keeps the password it was initialized with.
# Verify our .env matches it, otherwise the API could not connect later.
if ! $COMPOSE exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
    psql -h 127.0.0.1 -U initpad -d initpad -c 'select 1' >/dev/null 2>&1; then
  fail "The existing database volume was initialized with a different password
  than INITPAD_DB_PASSWORD in .env. Either restore the original .env, or start
  fresh:  docker compose down -v && rm .env && ./install.sh"
fi

say "Waiting for Gitea"
wait_healthy gitea 60

# The gitea CLI needs the config path and must run as the 'git' user.
GITEA_CONF=$($COMPOSE exec -T gitea sh -c \
  'test -f /data/gitea/conf/app.ini && echo /data/gitea/conf/app.ini || find /data -name app.ini 2>/dev/null | head -1' | tr -d '\r\n')
[ -n "$GITEA_CONF" ] || fail "Gitea app.ini not found."
GITEA_WORK=$(dirname "$(dirname "$GITEA_CONF")")
gitea_cli() { $COMPOSE exec -T -u git gitea gitea --work-path "$GITEA_WORK" --config "$GITEA_CONF" "$@"; }

# ---- 3. bootstrap: service account + tokens ---------------------------------
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

if [ -z "$(get_env INITPAD_RUNNER_TOKEN)" ]; then
  say "Generating CI runner registration token"
  out=$(gitea_cli actions generate-runner-token 2>&1)
  rtoken=$(printf '%s\n' "$out" | grep -E '^[A-Za-z0-9]{30,}$' | tail -1)
  [ -n "$rtoken" ] || fail "Could not parse the runner token. Output: $out"
  set_env INITPAD_RUNNER_TOKEN "$rtoken"
else
  say "Runner token already configured"
fi

# ---- 4. platform ------------------------------------------------------------
say "Building and starting the platform (api, web) — first build takes a few minutes"
$COMPOSE up -d --build api web
say "Waiting for the platform API"
wait_healthy api 60

# ---- 5. SSO — MUST run after the API is up: Gitea validates the discovery
# URL immediately when the auth source is registered.
if gitea_cli admin auth list 2>/dev/null | grep -q initpad-sso; then
  say "SSO authentication source already registered"
else
  say "Registering the platform as Gitea's OIDC sign-in (SSO)"
  gitea_cli admin auth add-oauth --name initpad-sso --provider openidConnect \
    --key gitea --secret "$OIDC_SECRET" \
    --auto-discover-url "http://api:3000/api/.well-known/openid-configuration" >/dev/null
fi

# ---- 6. runner (+ optional HTTPS proxy) --------------------------------------
rotate_runner_if_address_changed
say "Starting the CI runner"
if [ "$runner_config_changed" = yes ]; then
  # Bind-mounted config content is not part of Compose's service hash. Recreate
  # only when the rendered file changed so the runner actually reads the new
  # capacity without interrupting jobs on every idempotent installer run.
  $COMPOSE --profile runner up -d --force-recreate act_runner
  rm -f .runtime/runner-config.changed
else
  $COMPOSE --profile runner up -d act_runner
fi
if [ -n "${DOMAIN:-}" ]; then
  say "Starting Caddy reverse proxy for https://$DOMAIN"
  $COMPOSE --profile server up -d caddy
fi

# ---- 7. summary ---------------------------------------------------------------
PUBLIC_URL=$(get_env INITPAD_PUBLIC_URL); PUBLIC_URL=${PUBLIC_URL:-http://localhost:8080}
GITEA_URL=$(get_env INITPAD_GITEA_PUBLIC_URL); GITEA_URL=${GITEA_URL:-http://gitea.localhost:3001}
EDITION=$(get_env INITPAD_EDITION); EDITION=${EDITION:-self-hosted}
GH_CID=$(get_env INITPAD_GITHUB_CLIENT_ID)
GH_SEC=$(get_env INITPAD_GITHUB_CLIENT_SECRET)
GH_CB=$(get_env INITPAD_GITHUB_CALLBACK_URL)
GITHUB_ON=no
[ -n "$GH_CID" ] && [ -n "$GH_SEC" ] && [ -n "$GH_CB" ] && GITHUB_ON=yes

echo ""
if [ "$EDITION" = "saas" ]; then
  echo "  ✔ InitPad is running (SaaS edition)."
  echo ""
  echo "    Platform   ${PUBLIC_URL}"
  echo ""
  if [ "$GITHUB_ON" = "yes" ]; then
    echo "  Sign in with GitHub on the platform to create your account."
  else
    echo "  ⚠ SaaS edition, but GitHub is not configured — set INITPAD_GITHUB_* in"
    echo "    deploy/.env, otherwise there is no sign-in method available."
  fi
  echo "  Note: this stack still bundles Gitea internally (${GITEA_URL},"
  echo "        admin: ${BOT_USER}); the GitHub deploy path is not complete yet —"
  echo "        see ../PRODUCT_ROADMAP.md (public SaaS still requires InitPad Agent)."
else
  echo "  ✔ InitPad is running."
  echo ""
  echo "    Platform   ${PUBLIC_URL}"
  echo "    Gitea      ${GITEA_URL}   (admin: ${BOT_USER} / password in deploy/.env)"
  echo ""
  echo "  Create an account in the web UI and start your first project."
  [ "$GITHUB_ON" = "yes" ] && echo "  GitHub sign-in and account linking are enabled."
fi
echo "  Re-run ./install.sh anytime — it only fixes what is missing."
echo ""
