#!/usr/bin/env bash
# Restore an InitPad backup produced by backup.sh (ADR-062). DESTRUCTIVE: it
# overwrites the current database and data volumes. Stop-safe: application
# services are stopped first, then restarted at the end.
#
#   ./restore.sh <backup-dir>
#   ./restore.sh ./backups/20260101T020000Z
set -euo pipefail
cd "$(dirname "$0")"

RUNTIME_UPDATE_DIR=.runtime/platform-update
RUNTIME_OVERRIDE=$RUNTIME_UPDATE_DIR/platform-release.override.yml
mkdir -p "$RUNTIME_UPDATE_DIR"
chmod 700 "$RUNTIME_UPDATE_DIR"
if [ ! -f "$RUNTIME_OVERRIDE" ]; then
  printf 'services: {}\n' > "$RUNTIME_OVERRIDE"
  chmod 600 "$RUNTIME_OVERRIDE"
fi

say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
[ -f ./restore-reconcile.sql ] || fail "deploy/restore-reconcile.sql is missing."
restore_started=0
restore_failure() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$restore_started" -eq 1 ]; then
    printf '\033[1;31m✗\033[0m Restore did not complete; do not use the stack as a verified restore.\n' >&2
    printf '  Fix the reported error and run the same restore command again.\n' >&2
  fi
  exit "$status"
}
trap restore_failure EXIT

src=${1:-}
[ -n "$src" ] || {
  echo "Usage: ./restore.sh <backup-dir>"
  echo "Available backups:"
  ls -1d ./backups/*/ 2>/dev/null || echo "  (none in ./backups)"
  exit 1
}
[ -d "$src" ] || fail "Backup directory '$src' not found."
required_files=(
  postgres.dump initpad.env SHA256SUMS
  gitea-data.tar.gz minio-data.tar.gz api-data.tar.gz
  sftp-www.tar.gz runner-data.tar.gz
)
for file in "${required_files[@]}"; do
  [ -f "$src/$file" ] || fail "'$src/$file' missing — not a complete InitPad backup."
done
for file in "${required_files[@]}"; do
  [ "$file" = SHA256SUMS ] && continue
  entries=$(awk -v expected="$file" '$2 == expected { count++ } END { print count + 0 }' \
    "$src/SHA256SUMS")
  [ "$entries" -eq 1 ] || \
    fail "Checksum manifest must contain exactly one entry for '$file'."
done
if [ -f "$src/caddy-data.tar.gz" ]; then
  entries=$(awk '$2 == "caddy-data.tar.gz" { count++ } END { print count + 0 }' \
    "$src/SHA256SUMS")
  [ "$entries" -eq 1 ] || \
    fail "Optional caddy-data.tar.gz is not covered by the checksum manifest."
fi
if [ -f "$src/supervisor-data.tar.gz" ]; then
  entries=$(awk '$2 == "supervisor-data.tar.gz" { count++ } END { print count + 0 }' \
    "$src/SHA256SUMS")
  [ "$entries" -eq 1 ] || \
    fail "Optional supervisor-data.tar.gz is not covered by the checksum manifest."
fi
if [ -f "$src/platform-release.override.yml" ]; then
  entries=$(awk '$2 == "platform-release.override.yml" { count++ } END { print count + 0 }' \
    "$src/SHA256SUMS")
  [ "$entries" -eq 1 ] || \
    fail "Optional platform-release.override.yml is not covered by the checksum manifest."
fi

# Verify every archive before stopping or overwriting the live stack.
say "Verifying backup checksums"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$src" && sha256sum -c SHA256SUMS) || fail "Checksum verification failed."
elif command -v shasum >/dev/null 2>&1; then
  (cd "$src" && shasum -a 256 -c SHA256SUMS) || fail "Checksum verification failed."
else
  fail "Neither sha256sum nor shasum is installed."
fi
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
[ -z "$(docker ps -q --filter label=com.initpad.platform-update)" ] || \
  fail "A signed platform update is currently running; wait before restoring a backup."
docker run --rm -i postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685 pg_restore --list \
  < "$src/postgres.dump" >/dev/null || fail "PostgreSQL dump is not readable."

echo "⚠  This OVERWRITES the current database and data volumes from:"
echo "     $src"
read -r -p "Type 'restore' to continue: " confirm
[ "$confirm" = "restore" ] || { echo "Aborted."; exit 1; }
restore_started=1

COMPOSE=(docker compose)
COMPOSE_ALL=(docker compose --profile runner --profile server)

say "Stopping the complete stack, including optional profiles"
INITPAD_INSTALL_ROOT=$(cd .. && pwd -P) \
INITPAD_SUPERVISOR_SHARED_SECRET=restore-compatibility-only-00000000000000 \
  "${COMPOSE_ALL[@]}" stop >/dev/null 2>&1 || true

if [ -f .env ]; then
  previous_env=".env.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  cp .env "$previous_env"
  chmod 600 "$previous_env"
  say "Previous configuration saved to deploy/$previous_env"
fi
cp "$src/initpad.env" .env
chmod 600 .env

set_env() {
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {$0=k"="v; done=1} {print} END{if(!done) print k"="v}' .env > "$tmp"
  mv "$tmp" .env
  chmod 600 .env
}
get_env() {
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env
}
install_root=$(cd .. && pwd -P)
case "$install_root" in *$'\n'*|*$'\r'*) fail "Install path contains a newline.";; esac
set_env INITPAD_INSTALL_ROOT "$install_root"
set_env COMPOSE_FILE "docker-compose.yml:.runtime/platform-update/platform-release.override.yml"
if [ -z "$(get_env INITPAD_SUPERVISOR_SHARED_SECRET)" ]; then
  command -v openssl >/dev/null || \
    fail "openssl is required to initialize the release Supervisor secret."
  set_env INITPAD_SUPERVISOR_SHARED_SECRET "$(openssl rand -hex 32)"
fi
if [ -f "$src/platform-release.override.yml" ]; then
  rm -f "$RUNTIME_OVERRIDE"
  cp "$src/platform-release.override.yml" "$RUNTIME_OVERRIDE"
else
  rm -f "$RUNTIME_OVERRIDE"
  printf 'services: {}\n' > "$RUNTIME_OVERRIDE"
fi
chmod 600 "$RUNTIME_OVERRIDE"

restore_db_password=$(get_env INITPAD_DB_PASSWORD)
[ -n "$restore_db_password" ] || fail "Backup configuration has no INITPAD_DB_PASSWORD."
./render-runner-config.sh

say "Ensuring database is up"
"${COMPOSE[@]}" up -d postgres >/dev/null
# Wait for readiness.
database_ready=0
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U initpad >/dev/null 2>&1; then
    database_ready=1
    break
  fi
  sleep 1
done
[ "$database_ready" -eq 1 ] || fail "PostgreSQL did not become ready."

say "Restoring PostgreSQL (drop + recreate + load)"
"${COMPOSE[@]}" exec -T postgres psql -U initpad -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='initpad' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T postgres psql -U initpad -d postgres -c "DROP DATABASE IF EXISTS initpad;" >/dev/null
"${COMPOSE[@]}" exec -T postgres psql -U initpad -d postgres -c "CREATE DATABASE initpad;" >/dev/null
"${COMPOSE[@]}" exec -T postgres pg_restore -U initpad -d initpad --no-owner < "$src/postgres.dump"

# pg_dump does not include cluster roles. Align the existing/fresh role with
# the restored .env without interpolating the secret into SQL or logs.
printf "%s\n" "ALTER ROLE initpad PASSWORD :'restore_password';" | \
  "${COMPOSE[@]}" exec -T \
    -e "INITPAD_RESTORE_DB_PASSWORD=$restore_db_password" postgres sh -ec \
    'psql -v ON_ERROR_STOP=1 -U initpad -d postgres --set=restore_password="$INITPAD_RESTORE_DB_PASSWORD"' \
    >/dev/null

# A checkpoint may come from an older installed release. Upgrade its restored
# schema before the current recovery contract addresses newer durable tables.
say "Applying versioned database migrations to the restored checkpoint"
"${COMPOSE[@]}" run --rm --no-deps api node scripts/migrate.js >/dev/null

# Runtime targets are not part of a control-plane data backup. A workload may
# have been created, removed or redeployed after the checkpoint, so claiming
# its restored database status is still current would be unsafe. Preserve the
# artifact/version for deterministic redeploy, but require reconciliation.
say "Marking restored deployments for target reconciliation"
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U initpad -d initpad \
  < ./restore-reconcile.sql >/dev/null

# Only containers explicitly labelled as InitPad-managed are removed. Compose
# services and unrelated host workloads are outside this filter. Their tested
# images remain cached/archived so the restored environment can be redeployed.
managed_containers=()
while IFS= read -r container_id; do
  [ -n "$container_id" ] && managed_containers+=("$container_id")
done < <(docker ps -aq --filter label=com.initpad.managed=true)
if [ "${#managed_containers[@]}" -gt 0 ]; then
  say "Removing ${#managed_containers[@]} local runtime workload(s) with stale checkpoint state"
  docker rm -f "${managed_containers[@]}" >/dev/null
fi

restore_volume() {
  local volume=$1 archive=$2 required=${3:-yes}
  if [ ! -f "$src/$archive" ]; then
    [ "$required" = no ] && { say "volume ${volume} — no $archive, skipped"; return; }
    fail "Required volume archive '$archive' is missing."
  fi
  say "restoring volume ${volume}"
  docker run --rm \
    -v "${volume}:/target" \
    -v "$(cd "$src" && pwd):/backup:ro" \
    alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d sh -c 'rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null; tar -C /target -xzf "/backup/'"$archive"'"'
}

say "Restoring data volumes"
restore_volume initpad_gitea-data gitea-data.tar.gz
restore_volume initpad_minio-data minio-data.tar.gz
restore_volume initpad_api-data api-data.tar.gz
restore_volume initpad_supervisor-data supervisor-data.tar.gz no
restore_volume initpad_sftp-www sftp-www.tar.gz
restore_volume initpad_caddy-data caddy-data.tar.gz no
restore_volume initpad_runner-data runner-data.tar.gz

say "Starting the base stack"
"${COMPOSE[@]}" up -d >/dev/null

say "Starting the CI runner"
"${COMPOSE[@]}" --profile runner up -d runner-docker act_runner >/dev/null
rm -f .runtime/runner-config.changed

if [ -n "$(get_env INITPAD_DOMAIN)" ]; then
  say "Starting the HTTPS reverse proxy"
  "${COMPOSE[@]}" --profile server up -d caddy >/dev/null
fi

wait_healthy() {
  local service=$1 attempts=${2:-60} cid state
  for _ in $(seq 1 "$attempts"); do
    cid=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
    state=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  fail "$service did not become healthy after restore."
}

say "Verifying restored services"
wait_healthy minio 60
wait_healthy gitea 60
wait_healthy api 60
wait_healthy supervisor 60
wait_healthy runner-docker 60
runner_id=$("${COMPOSE[@]}" --profile runner ps -q act_runner)
[ -n "$runner_id" ] && [ "$(docker inspect --format '{{.State.Running}}' "$runner_id")" = true ] || \
  fail "act_runner is not running after restore."

restore_started=0
trap - EXIT
printf '\033[1;32m✔\033[0m Restore complete. Check: docker compose ps  and  docker compose logs -f api\n'
printf '   If the CI runner address changed, re-run ./install.sh to reconcile it.\n'
