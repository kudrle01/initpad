#!/usr/bin/env bash
# Non-destructive checkpoints for the clean-host self-hosted acceptance.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose --profile runner --profile server)
ACCEPTANCE_DIR=.runtime/acceptance
REBOOT_CHECKPOINT=$ACCEPTANCE_DIR/reboot.checkpoint
RESTORE_CHECKPOINT=$ACCEPTANCE_DIR/restore.checkpoint
REPORT=$ACCEPTANCE_DIR/results.tsv

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./self-hosted-check.sh <command> [argument]

  preflight             Check a clean Linux host before the first install
  running               Verify the installed control plane and CI runner
  before-reboot         Verify the stack and save a host-reboot checkpoint
  after-reboot          Prove that the host rebooted and the same stack recovered
  backup <directory>    Verify a backup and save its live identity checkpoint
  before-restore <directory> <marker-project>
                        Arm the destructive drill after creating the marker
  after-restore <directory>
                        Prove the exact checkpoint and recovery invariants returned

The script never prints .env, credentials or application secrets. Results are
appended to deploy/.runtime/acceptance/results.tsv, which is ignored by Git.
EOF
}

ensure_report() {
  mkdir -p "$ACCEPTANCE_DIR"
  chmod 700 "$ACCEPTANCE_DIR"
  touch "$REPORT"
  chmod 600 "$REPORT"
}

record() {
  ensure_report
  printf '%s\t%s\tPASS\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$REPORT"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is missing."
}

get_env() {
  [ -f .env ] || return 0
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' .env
}

boot_id() {
  [ -r /proc/sys/kernel/random/boot_id ] || fail "Linux boot ID is unavailable."
  tr -d '\r\n' < /proc/sys/kernel/random/boot_id
}

container_id() {
  local service=$1 id
  id=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
  [ -n "$id" ] || fail "Service '$service' has no container."
  printf '%s\n' "$id"
}

database_scalar() {
  database_scalar_in initpad "$1"
}

database_scalar_in() {
  local database=$1 query=$2
  docker compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -Atqc "$query" -U initpad -d "$database"
}

database_identity() {
  local database=${1:-initpad}
  database_scalar_in "$database" '
    SELECT md5(
      COALESCE((SELECT string_agg("id", $q$,$q$ ORDER BY "id") FROM "User"), $q$$q$) ||
      $q$|$q$ ||
      COALESCE((SELECT string_agg("id", $q$,$q$ ORDER BY "id") FROM "Workspace"), $q$$q$) ||
      $q$|$q$ ||
      COALESCE((SELECT string_agg("id", $q$,$q$ ORDER BY "id") FROM "Project"), $q$$q$)
    );
  '
}

restore_checkpoint_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' \
    "$RESTORE_CHECKPOINT"
}

canonical_directory() {
  local directory=$1 path
  path=$(cd "$directory" && pwd -P)
  case "$path" in *$'\n'*|*$'\r'*) fail "Backup path contains a newline.";; esac
  printf '%s\n' "$path"
}

manifest_digest() {
  sha256sum "$1/SHA256SUMS" | awk '{ print $1 }'
}

save_restore_checkpoint_from_dump() {
  local directory=$1 path probe users workspaces projects identity temporary
  path=$(canonical_directory "$directory")
  probe=initpad_acceptance_probe
  # The reserved name makes an interrupted inspection self-cleaning on retry.
  docker compose exec -T postgres \
    dropdb -U initpad --if-exists --force "$probe" >/dev/null 2>&1 || \
    fail "Could not clear an earlier backup inspection database."
  docker compose exec -T postgres createdb -U initpad "$probe" >/dev/null || \
    fail "Could not create the temporary backup inspection database."
  if ! docker compose exec -T postgres \
    pg_restore -U initpad -d "$probe" --no-owner --no-privileges \
      < "$path/postgres.dump" >/dev/null; then
    docker compose exec -T postgres dropdb -U initpad --if-exists "$probe" >/dev/null 2>&1 || true
    fail "Could not inspect the PostgreSQL backup in an isolated database."
  fi
  if ! users=$(database_scalar_in "$probe" 'SELECT count(*) FROM "User";') ||
     ! workspaces=$(database_scalar_in "$probe" 'SELECT count(*) FROM "Workspace";') ||
     ! projects=$(database_scalar_in "$probe" 'SELECT count(*) FROM "Project";') ||
     ! identity=$(database_identity "$probe"); then
    docker compose exec -T postgres dropdb -U initpad --if-exists "$probe" >/dev/null 2>&1 || true
    fail "Could not read durable identities from the backup inspection database."
  fi
  docker compose exec -T postgres dropdb -U initpad "$probe" >/dev/null || \
    fail "Could not remove the temporary backup inspection database."

  ensure_report
  temporary=$(mktemp "$ACCEPTANCE_DIR/restore.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'backup_path=%s\n' "$path"
    printf 'manifest_sha256=%s\n' "$(manifest_digest "$path")"
    printf 'users=%s\n' "$users"
    printf 'workspaces=%s\n' "$workspaces"
    printf 'projects=%s\n' "$projects"
    printf 'identity_fingerprint=%s\n' "$identity"
  } > "$temporary"
  mv "$temporary" "$RESTORE_CHECKPOINT"
}

verify_restore_checkpoint_backup() {
  local directory=$1 expected_path actual_path expected_digest actual_digest
  [ -f "$RESTORE_CHECKPOINT" ] || \
    fail "No restore checkpoint exists; verify the backup before creating the marker project."
  actual_path=$(canonical_directory "$directory")
  expected_path=$(restore_checkpoint_value backup_path)
  [ "$actual_path" = "$expected_path" ] || \
    fail "Restore checkpoint belongs to '$expected_path', not '$actual_path'."
  actual_digest=$(manifest_digest "$actual_path")
  expected_digest=$(restore_checkpoint_value manifest_sha256)
  [ "$actual_digest" = "$expected_digest" ] || \
    fail "Backup checksum manifest changed after the restore checkpoint was saved."
}

check_rootless_runner_prerequisite() {
  local restriction=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
  local profile=/etc/apparmor.d/usr.local.bin.rootlesskit
  [ -e "$restriction" ] || return 0
  [ "$(cat "$restriction")" = 1 ] || return 0
  [ -f "$profile" ] &&
    grep -Eq '^[[:space:]]*/usr/local/bin/rootlesskit[[:space:]]+flags=\(unconfined\)' "$profile" &&
    grep -Eq '^[[:space:]]*userns,[[:space:]]*$' "$profile" && return 0
  fail "Ubuntu AppArmor blocks the rootless CI daemon. Run 'sudo ./prepare-rootless-runner.sh', then repeat preflight."
}

check_preflight() {
  [ "$(uname -s)" = Linux ] || fail "Clean-host acceptance requires Linux."
  case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ;;
    *) fail "Unsupported CPU architecture: $(uname -m)." ;;
  esac
  for command in docker curl openssl awk grep sed sha256sum stat tar; do
    require_command "$command"
  done
  docker info >/dev/null 2>&1 || fail "Docker Engine is not running."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."
  check_rootless_runner_prerequisite

  local existing volumes cpus memory_kib docker_root docker_disk_kib
  local checkout_disk_kib install_root env_file docker_free_gib
  existing=$(docker ps -aq --filter label=com.docker.compose.project=initpad)
  [ -z "$existing" ] || fail "An InitPad Compose stack already exists on this host."
  volumes=$(docker volume ls --format '{{.Name}}' | grep '^initpad_' || true)
  [ -z "$volumes" ] || fail "InitPad data volumes already exist; use a disposable clean host."

  cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)
  memory_kib=$(awk '/^MemTotal:/ { print $2; exit }' /proc/meminfo)
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  case "$docker_root" in
    /*) ;;
    *) fail "Docker reported an invalid storage directory." ;;
  esac
  docker_disk_kib=$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')
  checkout_disk_kib=$(df -Pk .. | awk 'NR == 2 { print $4 }')
  case "$docker_disk_kib" in
    ''|*[!0-9]*) fail "Could not determine free space for Docker storage '$docker_root'." ;;
  esac
  case "$checkout_disk_kib" in
    ''|*[!0-9]*) fail "Could not determine free space for the InitPad checkout." ;;
  esac
  docker_free_gib=$((docker_disk_kib / 1024 / 1024))
  [ "$cpus" -ge 2 ] || fail "At least 2 CPU cores are required (4 recommended)."
  [ "$memory_kib" -ge 6291456 ] || fail "At least 6 GiB RAM is required (8 GiB recommended)."
  [ "$docker_disk_kib" -ge 20971520 ] || \
    fail "Docker storage '$docker_root' has ${docker_free_gib} GiB free; at least 20 GiB is required. Expand the guest partition/filesystem or free Docker storage."
  [ "$cpus" -ge 4 ] || warn "Only $cpus CPU cores are available; CI builds will be slower."
  [ "$memory_kib" -ge 8388608 ] || warn "Less than 8 GiB RAM is available."
  [ "$docker_disk_kib" -ge 41943040 ] || \
    warn "Docker storage has ${docker_free_gib} GiB free; monitor image and build-cache growth."

  install_root=$(cd .. && pwd -P)
  env_file=.env
  [ -f "$env_file" ] || env_file=.env.example
  INITPAD_INSTALL_ROOT="$install_root" \
  INITPAD_SUPERVISOR_SHARED_SECRET=acceptance-preflight-only-000000000000 \
    docker compose --env-file "$env_file" -f docker-compose.yml config --quiet
  record preflight "linux=$(uname -m) cpus=$cpus memory_kib=$memory_kib docker_disk_kib=$docker_disk_kib checkout_disk_kib=$checkout_disk_kib"
  pass "Clean-host preflight passed."
}

assert_service() {
  local service=$1 id state running health restart
  id=$(container_id "$service")
  state=$(docker inspect --format \
    '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.HostConfig.RestartPolicy.Name}}' \
    "$id")
  IFS='|' read -r running health restart <<< "$state"
  [ "$running" = true ] || fail "Service '$service' is not running."
  case "$health" in healthy|none) ;; *) fail "Service '$service' health is '$health'.";; esac
  [ "$restart" = unless-stopped ] || \
    fail "Service '$service' restart policy is '$restart', expected 'unless-stopped'."
}

release_channel() {
  local override=.runtime/platform-update/platform-release.override.yml
  [ -f "$override" ] || fail "Platform release override is missing."
  local content
  content=$(docker exec initpad-supervisor cat \
    /var/lib/initpad-supervisor/runtime/platform-release.override.yml 2>/dev/null) || \
    fail "The Supervisor cannot read the platform release override."
  if printf '%s\n' "$content" | grep -qx 'services: {}'; then
    printf 'source\n'
    return
  fi
  local references
  references=$(printf '%s\n' "$content" | \
    grep -Ec 'image: ".+@sha256:[a-f0-9]{64}"' || true)
  [ "$references" -eq 3 ] || \
    fail "Installed platform override does not contain three immutable image references."
  printf 'signed-release\n'
}

check_running() {
  [ "$(uname -s)" = Linux ] || fail "Self-hosted acceptance requires Linux."
  [ -f .env ] || fail "deploy/.env is missing; run ./install.sh first."
  ! grep -q '__GENERATE__' .env || fail "deploy/.env still contains ungenerated secrets."
  docker info >/dev/null 2>&1 || fail "Docker Engine is not running."
  "${COMPOSE[@]}" config --quiet

  local service domain web_port response mapping channel running_version users
  for service in postgres minio gitea api web supervisor runner-docker act_runner fake-vps fake-sftp static-web; do
    assert_service "$service"
  done
  domain=$(get_env INITPAD_DOMAIN)
  [ -z "$domain" ] || assert_service caddy

  web_port=$(get_env INITPAD_WEB_PORT); web_port=${web_port:-8080}
  response=$(mktemp "${TMPDIR:-/tmp}/initpad-running.XXXXXX")
  trap 'rm -f "$response"' EXIT
  curl -fsS --max-time 10 "http://127.0.0.1:${web_port}/api/health/ready" > "$response" || \
    fail "Platform readiness endpoint is unavailable."
  grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' "$response" || \
    fail "Platform readiness response is not ready."
  grep -Eq '"database"[[:space:]]*:[[:space:]]*"ok"' "$response" || \
    fail "Platform database is not ready."
  grep -Eq '"artifactStore"[[:space:]]*:[[:space:]]*"ok"' "$response" || \
    fail "Artifact storage is not ready."
  rm -f "$response"
  trap - EXIT

  mapping=$("${COMPOSE[@]}" exec -T runner-docker \
    grep 'host.docker.internal' /etc/hosts)
  printf '%s\n' "$mapping" | grep -Eq '^172\.31\.250\.1[[:space:]]+host\.docker\.internal$' || \
    fail "The isolated CI daemon has an unexpected host gateway mapping."
  "${COMPOSE[@]}" exec -T runner-docker \
    wget -qO- http://host.docker.internal:3001/api/healthz >/dev/null || \
    fail "The isolated CI daemon cannot reach Gitea."

  running_version=$(docker inspect "$(container_id api)" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' | \
    awk -F= '$1 == "INITPAD_PLATFORM_VERSION" { print $2; exit }')
  printf '%s\n' "$running_version" | \
    grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || \
    fail "Running API does not declare a stable platform version."
  users=$(database_scalar 'SELECT count(*) FROM "User";')
  channel=$(release_channel)
  record running "version=$running_version channel=$channel users=$users"
  pass "Installed self-hosted stack is healthy ($channel, version $running_version)."
}

write_reboot_checkpoint() {
  check_running
  local temporary users
  users=$(database_scalar 'SELECT count(*) FROM "User";')
  [ "$users" -ge 1 ] || fail "Create the first platform account before the reboot checkpoint."
  ensure_report
  temporary=$(mktemp "$ACCEPTANCE_DIR/reboot.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'boot_id=%s\n' "$(boot_id)"
    printf 'users=%s\n' "$users"
    for service in postgres gitea api web supervisor runner-docker act_runner; do
      printf '%s=%s\n' "$service" "$(container_id "$service")"
    done
  } > "$temporary"
  mv "$temporary" "$REBOOT_CHECKPOINT"
  record before-reboot "checkpoint_saved=true users=$users"
  pass "Reboot checkpoint saved. Reboot the Linux host without running install.sh again."
}

checkpoint_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' \
    "$REBOOT_CHECKPOINT"
}

check_after_reboot() {
  [ -f "$REBOOT_CHECKPOINT" ] || fail "No reboot checkpoint exists; run before-reboot first."
  local previous_boot current_boot expected actual service expected_users actual_users
  previous_boot=$(checkpoint_value boot_id)
  current_boot=$(boot_id)
  [ -n "$previous_boot" ] && [ "$previous_boot" != "$current_boot" ] || \
    fail "The host boot ID did not change; a container restart is not a host reboot."
  check_running
  for service in postgres gitea api web supervisor runner-docker act_runner; do
    expected=$(checkpoint_value "$service")
    actual=$(container_id "$service")
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || \
      fail "Service '$service' was recreated instead of recovering after reboot."
  done
  expected_users=$(checkpoint_value users)
  actual_users=$(database_scalar 'SELECT count(*) FROM "User";')
  [ "$expected_users" = "$actual_users" ] || \
    fail "User count changed across reboot ($expected_users -> $actual_users)."
  rm -f "$REBOOT_CHECKPOINT"
  record after-reboot "boot_changed=true containers_preserved=true users=$actual_users"
  pass "Host reboot recovery passed without reinstalling or recreating the stack."
}

check_backup() {
  local directory=${1:-}
  [ -n "$directory" ] || fail "Usage: ./self-hosted-check.sh backup <directory>"
  [ -d "$directory" ] || fail "Backup directory '$directory' does not exist."
  local required file mode
  required=(
    SHA256SUMS postgres.dump initpad.env gitea-data.tar.gz minio-data.tar.gz
    api-data.tar.gz supervisor-data.tar.gz sftp-www.tar.gz runner-data.tar.gz
    platform-release.override.yml
  )
  for file in "${required[@]}"; do
    [ -f "$directory/$file" ] || fail "Backup is missing '$file'."
  done
  mode=$(stat -c '%a' "$directory/initpad.env")
  [ "$mode" = 600 ] || fail "Backup initpad.env mode is $mode, expected 600."
  mode=$(stat -c '%a' "$directory/platform-release.override.yml")
  [ "$mode" = 600 ] || fail "Backup platform release descriptor mode is $mode, expected 600."
  (cd "$directory" && sha256sum --strict -c SHA256SUMS >/dev/null) || \
    fail "Backup checksum verification failed."
  for file in gitea-data.tar.gz minio-data.tar.gz api-data.tar.gz \
    supervisor-data.tar.gz sftp-www.tar.gz runner-data.tar.gz; do
    tar -tzf "$directory/$file" >/dev/null || fail "Backup archive '$file' is unreadable."
  done
  docker run --rm -i \
    postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685 \
    pg_restore --list < "$directory/postgres.dump" >/dev/null || \
    fail "Backup PostgreSQL dump is unreadable."
  save_restore_checkpoint_from_dump "$directory"
  record backup "directory=$(basename "$directory") checksums=true archives=true dump=true"
  pass "Backup is complete and its restore identity checkpoint is saved."
  printf '  Create one marker project after this backup, then run before-restore.\n'
}

check_before_restore() {
  local directory=$1 marker=$2 existing_marker baseline_projects current_projects marker_count
  if [ ! -f "$RESTORE_CHECKPOINT" ]; then
    warn "Restore checkpoint was not prepared; deriving it from the verified backup now."
    check_backup "$directory"
  fi
  verify_restore_checkpoint_backup "$directory"
  case "$marker" in
    ''|*[!A-Za-z0-9._-]*) \
      fail "Marker project must use only letters, numbers, dots, underscores or hyphens." ;;
  esac
  existing_marker=$(restore_checkpoint_value marker_project)
  if [ -n "$existing_marker" ] && [ "$existing_marker" != "$marker" ]; then
    fail "Restore checkpoint is already armed for marker project '$existing_marker'."
  fi
  current_projects=$(database_scalar 'SELECT count(*) FROM "Project";')
  baseline_projects=$(restore_checkpoint_value projects)
  [ "$current_projects" -gt "$baseline_projects" ] || \
    fail "Create the marker project after the backup before arming the restore drill."
  marker_count=$(database_scalar \
    "SELECT count(*) FROM \"Project\" WHERE \"name\" = '$marker';")
  [ "$marker_count" -ge 1 ] || \
    fail "Post-backup marker project '$marker' does not exist."
  if [ -z "$existing_marker" ]; then
    printf 'marker_project=%s\n' "$marker" >> "$RESTORE_CHECKPOINT"
  fi
  record before-restore \
    "directory=$(basename "$directory") marker_present=true projects=$current_projects"
  pass "Restore drill armed. The next step is the destructive restore command."
}

check_after_restore() {
  local directory=$1 expected actual marker marker_count field
  verify_restore_checkpoint_backup "$directory"
  marker=$(restore_checkpoint_value marker_project)
  [ -n "$marker" ] || \
    fail "Restore drill is not armed; run before-restore with a post-backup marker project."

  check_running
  for field in users workspaces projects; do
    case "$field" in
      users) actual=$(database_scalar 'SELECT count(*) FROM "User";') ;;
      workspaces) actual=$(database_scalar 'SELECT count(*) FROM "Workspace";') ;;
      projects) actual=$(database_scalar 'SELECT count(*) FROM "Project";') ;;
    esac
    expected=$(restore_checkpoint_value "$field")
    [ "$actual" = "$expected" ] || \
      fail "Restored $field count differs from the checkpoint ($expected -> $actual)."
  done
  expected=$(restore_checkpoint_value identity_fingerprint)
  actual=$(database_identity)
  [ "$actual" = "$expected" ] || \
    fail "Restored user/workspace/project identity differs from the backup checkpoint."
  marker_count=$(database_scalar \
    "SELECT count(*) FROM \"Project\" WHERE \"name\" = '$marker';")
  [ "$marker_count" = 0 ] || \
    fail "Post-backup marker project '$marker' survived the restore."

  ./recovery-drill.sh verify-restore
  rm -f "$RESTORE_CHECKPOINT"
  record after-restore \
    "directory=$(basename "$directory") identity_restored=true marker_absent=true reconciliation=true"
  pass "Destructive restore acceptance passed for the exact backup checkpoint."
}

case "${1:-}" in
  preflight) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; check_preflight ;;
  running) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; check_running ;;
  before-reboot) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; write_reboot_checkpoint ;;
  after-reboot) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; check_after_reboot ;;
  backup) [ "$#" -eq 2 ] || { usage >&2; exit 1; }; check_backup "$2" ;;
  before-restore) [ "$#" -eq 3 ] || { usage >&2; exit 1; }; check_before_restore "$2" "$3" ;;
  after-restore) [ "$#" -eq 2 ] || { usage >&2; exit 1; }; check_after_restore "$2" ;;
  -h|--help|'') usage ;;
  *) usage >&2; exit 1 ;;
esac
