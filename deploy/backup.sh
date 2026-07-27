#!/usr/bin/env bash
# Consistent InitPad backup. PostgreSQL is dumped logically; file-backed
# volumes are archived read-only. The output contains secrets — store it as
# confidential data and encrypt it before copying off-host.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose --profile runner --profile server)
WRITER_SERVICES=(
  api web act_runner runner-docker
  gitea minio fake-sftp static-web caddy
)
running_services=()
quiesced=0
backup_files=(postgres.dump)

say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

while IFS= read -r service; do
  [ -n "$service" ] && running_services+=("$service")
done < <("${COMPOSE[@]}" ps --status running --services)

restart_previous_services() {
  [ "$quiesced" -eq 1 ] || return 0
  if [ "${#running_services[@]}" -gt 0 ]; then
    say "Restarting services that were running before the backup"
    "${COMPOSE[@]}" up -d "${running_services[@]}" >/dev/null
  fi
  quiesced=0
}

restart_after_failure() {
  local status=$?
  trap - EXIT
  if [ "$quiesced" -eq 1 ]; then
    set +e
    restart_previous_services
    local restart_status=$?
    set -e
    if [ "$restart_status" -ne 0 ]; then
      printf '\033[1;31m✗\033[0m Backup failed and the previous services could not be restarted.\n' >&2
      printf '  Recover with: docker compose --profile runner --profile server up -d\n' >&2
      status=1
    fi
  fi
  exit "$status"
}
trap restart_after_failure EXIT

stamp=$(date -u +%Y%m%dT%H%M%SZ)
custom_dest=${1:-}
destination=${custom_dest:-"./backups/$stamp"}
mkdir -p "$destination"
chmod 700 "$destination"

say "Quiescing platform writers for a consistent checkpoint"
quiesced=1
"${COMPOSE[@]}" stop "${WRITER_SERVICES[@]}" >/dev/null

say "Creating a logical PostgreSQL snapshot"
docker compose exec -T postgres pg_dump -U initpad -d initpad -Fc > "$destination/postgres.dump"

archive_volume() {
  local volume=$1 output=$2 required=${3:-yes}
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    if [ "$required" = no ]; then
      say "Optional volume $volume does not exist — skipped"
      return 0
    fi
    fail "Required Docker volume '$volume' does not exist. Run ./install.sh first."
  fi
  docker run --rm \
    -v "${volume}:/source:ro" \
    -v "$(cd "$destination" && pwd):/backup" \
    alpine:3.21 tar -C /source -czf "/backup/${output}" .
  backup_files+=("$output")
}

say "Archiving inactive data volumes"
archive_volume initpad_gitea-data gitea-data.tar.gz
archive_volume initpad_minio-data minio-data.tar.gz
archive_volume initpad_api-data api-data.tar.gz
archive_volume initpad_sftp-www sftp-www.tar.gz
archive_volume initpad_caddy-data caddy-data.tar.gz no
archive_volume initpad_runner-data runner-data.tar.gz

[ -f .env ] || fail "deploy/.env is missing. Run ./install.sh first."
cp .env "$destination/initpad.env"
chmod 600 "$destination/initpad.env"
backup_files+=(initpad.env)
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$destination" && sha256sum "${backup_files[@]}" > SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$destination" && shasum -a 256 "${backup_files[@]}" > SHA256SUMS)
else
  fail "Neither sha256sum nor shasum is installed."
fi

# Rotation — keep the newest N backups in the default ./backups directory.
# Skipped when a custom destination was passed as $1.
if [ -z "$custom_dest" ]; then
  keep=${INITPAD_BACKUP_KEEP:-7}
  # shellcheck disable=SC2012
  ls -1dt ./backups/*/ 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm -rf
fi

restart_previous_services
trap - EXIT

printf 'Backup written to %s\n' "$destination"
printf 'It contains credentials. Encrypt it and test restoration regularly.\n'
