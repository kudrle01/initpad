#!/usr/bin/env bash
# Consistent InitPad backup. PostgreSQL is dumped logically; file-backed
# volumes are archived read-only. The output contains secrets — store it as
# confidential data and encrypt it before copying off-host.
set -euo pipefail
cd "$(dirname "$0")"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination=${1:-"./backups/$stamp"}
mkdir -p "$destination"
chmod 700 "$destination"

docker compose exec -T postgres pg_dump -U initpad -d initpad -Fc > "$destination/postgres.dump"

archive_volume() {
  local volume=$1 output=$2
  docker run --rm \
    -v "${volume}:/source:ro" \
    -v "$(cd "$destination" && pwd):/backup" \
    alpine:3.21 tar -C /source -czf "/backup/${output}" .
}

archive_volume initpad_gitea-data gitea-data.tar.gz
archive_volume initpad_api-data api-data.tar.gz
archive_volume initpad_sftp-www sftp-www.tar.gz
archive_volume initpad_caddy-data caddy-data.tar.gz
archive_volume initpad_runner-data runner-data.tar.gz

cp .env "$destination/initpad.env"
chmod 600 "$destination/initpad.env"
(cd "$destination" && shasum -a 256 ./* > SHA256SUMS)

printf 'Backup written to %s\n' "$destination"
printf 'It contains credentials. Encrypt it and test restoration regularly.\n'
