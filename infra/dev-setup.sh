#!/usr/bin/env bash
# Development stack for `npm run dev:api` / `npm run dev:web` (ADR-175).
#
#   ./infra/dev-setup.sh          start postgres, Gitea, S3 and the SFTP target,
#                                 create the Gitea service account and token,
#                                 write apps/api/.env and migrate the database
#   ./infra/dev-setup.sh ci       also register and start the isolated CI runner
#   ./infra/dev-setup.sh sso      register Gitea sign-in through the dev API
#                                 (run while `npm run dev:api` is up)
#   ./infra/dev-setup.sh down     stop the stack (data stays)
#   ./infra/dev-setup.sh reset    stop it and delete its volumes and apps/api/.env
#
# Idempotent. The stack is the Compose project initpad-dev with its own
# volumes and ports, so it never touches a deploy/ installation.
set -euo pipefail
INFRA=$(cd "$(dirname "$0")" && pwd -P)
ROOT=$(dirname "$INFRA")
API_ENV=$ROOT/apps/api/.env
DEV_ENV=$INFRA/.env
BOT_USER=initpad-bot
GITEA_PORT=3002

say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
random_secret() { openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

command -v docker >/dev/null || fail "Docker is not installed (https://docs.docker.com/get-docker/)."
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is missing: https://docs.docker.com/compose/install/"

COMPOSE=(docker compose -f "$INFRA/docker-compose.yml")
docker compose --progress quiet version >/dev/null 2>&1 && COMPOSE=(docker compose --progress quiet -f "$INFRA/docker-compose.yml")
# Docker Desktop resolves host.docker.internal itself; plain Linux needs the
# host-gateway mapping so Gitea reaches the dev API for SSO and webhooks.
if [ "$(uname -s)" = Linux ] && ! docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -q 'Docker Desktop'; then
  COMPOSE+=(-f "$INFRA/docker-compose.linux.yml")
fi

get_kv() { [ -f "$1" ] && awk -F= -v k="$2" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "$1" || true; }
set_kv() { # <file> <key> <value>
  local tmp; tmp=$(mktemp)
  touch "$1"
  awk -v k="$2" -v v="$3" 'BEGIN{FS=OFS="="} $1==k {$0=k"="v; done=1} {print} END{if(!done) print k"="v}' "$1" > "$tmp"
  mv "$tmp" "$1"
  chmod 600 "$1"
}

wait_healthy() { # <service>
  local cid state
  for _ in $(seq 1 60); do
    cid=$("${COMPOSE[@]}" ps -q "$1" 2>/dev/null || true)
    state=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  fail "$1 did not become healthy — check: docker compose -p initpad-dev logs $1"
}

gitea_cli() {
  "${COMPOSE[@]}" exec -T -u git gitea gitea --work-path /data/gitea --config /data/gitea/conf/app.ini "$@"
}

check_port() { # <port> <purpose>
  local owner
  owner=$(docker ps --filter "publish=$1" --format '{{.Names}}' | head -n 1)
  case "$owner" in initpad-dev-*) return 0 ;; esac
  if [ -n "$owner" ] || { command -v ss >/dev/null && [ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]; }; then
    fail "Port $1 ($2) is already in use${owner:+ by the container $owner}. Free it and run again."
  fi
}

up() {
  check_port 5432 PostgreSQL
  check_port "$GITEA_PORT" Gitea
  check_port 8086 "static web"
  check_port 2222 SFTP
  check_port 9100 S3

  [ -n "$(get_kv "$DEV_ENV" INITPAD_DEV_S3_SECRET_ACCESS_KEY)" ] ||
    set_kv "$DEV_ENV" INITPAD_DEV_S3_SECRET_ACCESS_KEY "$(random_secret)"

  say "Starting the development stack (project initpad-dev)"
  "${COMPOSE[@]}" up -d --wait postgres gitea s3 fake-sftp static-web >/dev/null
  "${COMPOSE[@]}" up -d s3-init >/dev/null
  wait_healthy gitea

  if gitea_cli admin user list 2>/dev/null | awk '{print $2}' | grep -qx "$BOT_USER"; then
    say "Gitea service account '$BOT_USER' exists"
  else
    say "Creating the Gitea service account '$BOT_USER'"
    gitea_cli admin user create --admin --username "$BOT_USER" --random-password \
      --email bot@initpad.local --must-change-password=false >/dev/null
  fi

  if [ ! -f "$API_ENV" ]; then
    say "Writing apps/api/.env from apps/api/.env.example"
    cp "$ROOT/apps/api/.env.example" "$API_ENV"
    chmod 600 "$API_ENV"
  fi
  # Placeholders get real random values; existing values stay.
  local key
  for key in INITPAD_ENCRYPTION_KEY INITPAD_SCM_WEBHOOK_TOKEN INITPAD_JWT_SECRET INITPAD_OIDC_CLIENT_SECRET; do
    case "$(get_kv "$API_ENV" "$key")" in ''|zmen-me*) set_kv "$API_ENV" "$key" "$(random_secret)" ;; esac
  done
  if [ -z "$(get_kv "$API_ENV" INITPAD_GITEA_TOKEN)" ]; then
    say "Issuing the Gitea access token"
    local out token
    out=$(gitea_cli admin user generate-access-token --username "$BOT_USER" \
      --token-name "initpad-dev-$(date +%s)" --scopes all 2>&1)
    token=$(printf '%s\n' "$out" | grep -oE '[0-9a-f]{40}' | tail -1)
    [ -n "$token" ] || fail "Could not read the Gitea access token."
    set_kv "$API_ENV" INITPAD_GITEA_TOKEN "$token"
  fi
  set_kv "$API_ENV" INITPAD_GITEA_USER "$BOT_USER"
  set_kv "$API_ENV" INITPAD_GITEA_URL "http://gitea.localhost:$GITEA_PORT"
  set_kv "$API_ENV" INITPAD_GITEA_INTERNAL_URL "http://127.0.0.1:$GITEA_PORT"
  set_kv "$API_ENV" INITPAD_REGISTRY_HOST "127.0.0.1:$GITEA_PORT"
  set_kv "$API_ENV" INITPAD_CI_REGISTRY_HOST "host.docker.internal:$GITEA_PORT"
  set_kv "$API_ENV" INITPAD_SFTP_PUBLIC_URL "http://localhost:8086"
  set_kv "$API_ENV" INITPAD_ARTIFACT_S3_ENDPOINT "http://127.0.0.1:9100"
  set_kv "$API_ENV" INITPAD_ARTIFACT_S3_BUCKET initpad-artifacts
  set_kv "$API_ENV" INITPAD_ARTIFACT_S3_ACCESS_KEY_ID initpad
  set_kv "$API_ENV" INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY "$(get_kv "$DEV_ENV" INITPAD_DEV_S3_SECRET_ACCESS_KEY)"
  set_kv "$API_ENV" INITPAD_ARTIFACT_S3_FORCE_PATH_STYLE true

  say "Applying database migrations"
  # `migrate deploy` applies the committed migrations without prompting;
  # `npm run db:migrate` (migrate dev) is for authoring a new migration.
  (cd "$ROOT/apps/api" && PRISMA_HIDE_UPDATE_MESSAGE=1 "$ROOT/node_modules/.bin/prisma" migrate deploy >/dev/null 2>&1) ||
    fail "Database migration failed. Run 'npm ci' first, then ./infra/dev-setup.sh again."

  cat <<EOF

  ✔ Development stack is ready.

    npm run dev:api        API on http://localhost:3000/api
    npm run dev:web        web on http://localhost:5173
    Gitea                  http://gitea.localhost:$GITEA_PORT

  Optional: ./infra/dev-setup.sh ci (CI runner), ./infra/dev-setup.sh sso
  (Gitea sign-in through the dev API, while it runs).
EOF
}

ci() {
  up >/dev/null
  if [ -z "$(get_kv "$DEV_ENV" INITPAD_RUNNER_TOKEN)" ]; then
    say "Generating the CI runner registration token"
    local out token
    out=$(gitea_cli actions generate-runner-token 2>&1)
    token=$(printf '%s\n' "$out" | grep -E '^[A-Za-z0-9]{30,}$' | tail -1)
    [ -n "$token" ] || fail "Could not read the runner token."
    set_kv "$DEV_ENV" INITPAD_RUNNER_TOKEN "$token"
  fi
  say "Starting the isolated CI runner"
  "${COMPOSE[@]}" --profile ci up -d act_runner
  say "CI runner started"
}

sso() {
  local secret id
  secret=$(get_kv "$API_ENV" INITPAD_OIDC_CLIENT_SECRET)
  [ -n "$secret" ] || fail "Run ./infra/dev-setup.sh first."
  # Gitea validates the discovery URL immediately, so the dev API must run.
  "${COMPOSE[@]}" exec -T gitea curl -fsS -m 10 -o /dev/null \
    http://host.docker.internal:3000/api/.well-known/openid-configuration ||
    fail "Gitea cannot reach the dev API at host.docker.internal:3000.
Start npm run dev:api first. If it runs, a host firewall drops traffic from Docker
networks to the host; with ufw allow just this network:
  sudo ufw allow in on br-\$(docker network inspect initpad-dev_platform -f '{{printf \"%.12s\" .Id}}') to any port 3000 proto tcp"
  id=$(gitea_cli admin auth list 2>/dev/null | awk '$2=="initpad-sso" {print $1; exit}')
  if [ -n "$id" ]; then
    gitea_cli admin auth update-oauth --id "$id" --name initpad-sso --provider openidConnect \
      --key gitea --secret "$secret" \
      --auto-discover-url http://host.docker.internal:3000/api/.well-known/openid-configuration >/dev/null
  else
    gitea_cli admin auth add-oauth --name initpad-sso --provider openidConnect \
      --key gitea --secret "$secret" \
      --auto-discover-url http://host.docker.internal:3000/api/.well-known/openid-configuration >/dev/null
  fi
  "${COMPOSE[@]}" restart gitea >/dev/null
  wait_healthy gitea
  say "Gitea signs in through the dev API"
}

case "${1:-up}" in
  up) up ;;
  ci) ci ;;
  sso) sso ;;
  down) "${COMPOSE[@]}" --profile ci down ;;
  reset)
    "${COMPOSE[@]}" --profile ci down -v --remove-orphans
    rm -f "$API_ENV" "$DEV_ENV"
    say "Development stack and apps/api/.env removed"
    ;;
  -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) fail "Unknown command: $1 (try --help)" ;;
esac
