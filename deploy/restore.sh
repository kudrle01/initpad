#!/usr/bin/env bash
# Restore an InitPad backup produced by backup.sh (ADR-062). DESTRUCTIVE: it
# overwrites the current database and data volumes. Stop-safe: application
# services are stopped first, then restarted at the end.
#
#   ./restore.sh <backup-dir>
#   ./restore.sh ./backups/20260101T020000Z
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

src=${1:-}
[ -n "$src" ] || {
  echo "Usage: ./restore.sh <backup-dir>"
  echo "Available backups:"
  ls -1d ./backups/*/ 2>/dev/null || echo "  (none in ./backups)"
  exit 1
}
[ -d "$src" ] || fail "Backup directory '$src' not found."
[ -f "$src/postgres.dump" ] || fail "'$src/postgres.dump' missing — not a valid backup."
[ -f "$src/initpad.env" ] || fail "'$src/initpad.env' missing — encrypted data could not be recovered safely."

# Integrity check when SHA256SUMS is present.
if [ -f "$src/SHA256SUMS" ]; then
  say "Verifying checksums"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$src" && sha256sum -c SHA256SUMS) || fail "Checksum verification failed."
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$src" && shasum -a 256 -c SHA256SUMS) || fail "Checksum verification failed."
  else
    fail "Neither sha256sum nor shasum is installed."
  fi
fi

echo "⚠  This OVERWRITES the current database and data volumes from:"
echo "     $src"
read -r -p "Type 'restore' to continue: " confirm
[ "$confirm" = "restore" ] || { echo "Aborted."; exit 1; }

COMPOSE=(docker compose)
COMPOSE_ALL=(docker compose --profile runner --profile server)

say "Stopping the complete stack, including optional profiles"
"${COMPOSE_ALL[@]}" stop >/dev/null 2>&1 || true

if [ -f .env ]; then
  previous_env=".env.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  cp .env "$previous_env"
  chmod 600 "$previous_env"
  say "Previous configuration saved to deploy/$previous_env"
fi
cp "$src/initpad.env" .env
chmod 600 .env

get_env() {
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env
}
restore_db_password=$(get_env INITPAD_DB_PASSWORD)
[ -n "$restore_db_password" ] || fail "Backup configuration has no INITPAD_DB_PASSWORD."

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

restore_volume() {
  local volume=$1 archive=$2
  [ -f "$src/$archive" ] || { say "volume ${volume} — no $archive, skipped"; return; }
  say "restoring volume ${volume}"
  docker run --rm \
    -v "${volume}:/target" \
    -v "$(cd "$src" && pwd):/backup:ro" \
    alpine:3.21 sh -c 'rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null; tar -C /target -xzf "/backup/'"$archive"'"'
}

say "Restoring data volumes"
restore_volume initpad_gitea-data gitea-data.tar.gz
restore_volume initpad_minio-data minio-data.tar.gz
restore_volume initpad_api-data api-data.tar.gz
restore_volume initpad_sftp-www sftp-www.tar.gz
restore_volume initpad_caddy-data caddy-data.tar.gz
restore_volume initpad_runner-data runner-data.tar.gz

say "Starting the base stack"
"${COMPOSE[@]}" up -d >/dev/null

say "Starting the CI runner"
"${COMPOSE[@]}" --profile runner up -d runner-docker act_runner >/dev/null

if [ -n "$(get_env INITPAD_DOMAIN)" ]; then
  say "Starting the HTTPS reverse proxy"
  "${COMPOSE[@]}" --profile server up -d caddy >/dev/null
fi

printf '\033[1;32m✔\033[0m Restore complete. Check: docker compose ps  and  docker compose logs -f api\n'
printf '   If the CI runner address changed, re-run ./install.sh to reconcile it.\n'
