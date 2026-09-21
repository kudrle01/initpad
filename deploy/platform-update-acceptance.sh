#!/usr/bin/env bash
# Deterministic live acceptance for a signed self-hosted platform update.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose --profile runner --profile server)
ACCEPTANCE_DIR=.runtime/acceptance
CHECKPOINT=$ACCEPTANCE_DIR/platform-update.checkpoint
REBOOT_CHECKPOINT=$ACCEPTANCE_DIR/platform-update-reboot.checkpoint
REPORT=$ACCEPTANCE_DIR/results.tsv
OVERRIDE=.runtime/platform-update/platform-release.override.yml
PAUSED_HELPER=

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
say()  { printf '\033[1;36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

unpause_on_exit() {
  [ -z "$PAUSED_HELPER" ] || docker unpause "$PAUSED_HELPER" >/dev/null 2>&1 || true
}
trap unpause_on_exit EXIT

usage() {
  cat <<'EOF'
Usage: ./platform-update-acceptance.sh <command> [versions]

  prepare <current> <next>  Save the durable baseline before testing an update
  fault-rollback            Stop the candidate API and prove automatic rollback
  after-rollback            Verify version, data and workloads after that rollback
  interrupt-reboot          Pause the updater during API cutover and reboot the host
  after-reboot              Prove reboot recovery returned to the previous release
  after-success             Prove the final clean update preserved data and workloads

Run prepare once on the disposable Linux control-plane host. For fault-rollback
and interrupt-reboot, start the command in a terminal and then click Install
update in InitPad. interrupt-reboot validates sudo before it waits and reboots
the host only after the signed candidate API is running and the updater is
paused. No application secret or release credential is printed.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is missing."
}

stable_version() {
  printf '%s\n' "$1" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
}

newer_version() {
  local current=$1 next=$2 current_major current_minor current_patch
  local next_major next_minor next_patch
  IFS=. read -r current_major current_minor current_patch <<< "$current"
  IFS=. read -r next_major next_minor next_patch <<< "$next"
  [ "$next_major" -gt "$current_major" ] ||
    { [ "$next_major" -eq "$current_major" ] && [ "$next_minor" -gt "$current_minor" ]; } ||
    { [ "$next_major" -eq "$current_major" ] && [ "$next_minor" -eq "$current_minor" ] &&
      [ "$next_patch" -gt "$current_patch" ]; }
}

validate_transition() {
  local current=$1 next=$2
  stable_version "$current" || fail "Current version '$current' is invalid."
  stable_version "$next" || fail "Next version '$next' is invalid."
  newer_version "$current" "$next" || \
    fail "Next platform version $next must be newer than $current."
}

ensure_runtime() {
  [ "$(uname -s)" = Linux ] || fail "Platform update acceptance requires Linux."
  for command in docker curl awk grep sed sha256sum sort sudo; do
    require_command "$command"
  done
  [ -f .env ] || fail "deploy/.env is missing; install InitPad first."
  [ -f "$OVERRIDE" ] || fail "The platform release override is missing."
  [ -r "$OVERRIDE" ] || \
    fail "The platform release override is not readable by this operator. Restore its ownership before continuing; see OPERATIONS.md."
  docker info >/dev/null 2>&1 || fail "Docker Engine is not running."
  "${COMPOSE[@]}" config --quiet
  mkdir -p "$ACCEPTANCE_DIR"
  chmod 700 "$ACCEPTANCE_DIR"
  touch "$REPORT"
  chmod 600 "$REPORT"
}

record() {
  printf '%s\t%s\tPASS\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$REPORT"
}

checkpoint_value() {
  local key=$1 file=${2:-$CHECKPOINT}
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

state_value() {
  local path=$1
  docker exec initpad-supervisor node -e '
    const fs = require("node:fs");
    let value = JSON.parse(fs.readFileSync("/var/lib/initpad-supervisor/state.json", "utf8"));
    for (const part of process.argv[1].split(".")) value = value == null ? null : value[part];
    if (value != null) process.stdout.write(String(value));
  ' "$path" 2>/dev/null
}

container_id() {
  local service=$1 id
  id=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
  [ -n "$id" ] || fail "Service '$service' has no container."
  printf '%s\n' "$id"
}

container_image() {
  docker inspect --format '{{.Config.Image}}' "$(container_id "$1")"
}

runtime_override_sha256() {
  sha256sum "$OVERRIDE" | awk '{ print $1 }'
}

assert_supervisor_helper_image_available() {
  local supervisor_id image_id configured_image
  supervisor_id=$(container_id supervisor)
  image_id=$(docker inspect --format '{{.Image}}' "$supervisor_id")
  configured_image=$(docker inspect --format '{{.Config.Image}}' "$supervisor_id")
  if docker image inspect "$image_id" >/dev/null 2>&1; then
    return 0
  fi

  case "$configured_image" in
    *@sha256:*)
      fail "The running Supervisor image record is missing. Pull the exact immutable image '$configured_image', recreate only the Supervisor, and retry."
      ;;
    *:source)
      fail "The running source Supervisor image record is missing. Rebuild the exact installed platform tag and recreate only the Supervisor before this drill; see SELF_HOSTED_ACCEPTANCE.md."
      ;;
    *)
      fail "The running Supervisor image record '$image_id' is missing; restore its exact image before this drill."
      ;;
  esac
}

override_image() {
  local service=$1
  awk -v section="  $service:" '
    $0 == section { active=1; next }
    active && /^  [A-Za-z0-9_-]+:/ { exit }
    active && $1 == "image:" { gsub(/^"|"$/, "", $2); print $2; exit }
  ' "$OVERRIDE"
}

database_scalar() {
  docker compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -Atqc "$1" -U initpad -d initpad
}

database_identity() {
  database_scalar '
    SELECT md5(
      COALESCE((SELECT string_agg("id", $q$,$q$ ORDER BY "id") FROM "User"), $q$$q$) ||
      $q$|$q$ ||
      COALESCE((SELECT string_agg("id", $q$,$q$ ORDER BY "id") FROM "Workspace"), $q$$q$) ||
      $q$|$q$ ||
      COALESCE((SELECT string_agg("id", $q$,$q$ ORDER BY "id") FROM "Project"), $q$$q$)
    );
  '
}

managed_workload_snapshot() {
  docker ps -a --filter label=com.initpad.managed=true \
    --format '{{.ID}}|{{.Image}}|{{.Names}}' | sort | sha256sum | awk '{ print $1 }'
}

managed_workload_count() {
  docker ps -a --filter label=com.initpad.managed=true --format '{{.ID}}' | awk 'NF { n++ } END { print n + 0 }'
}

boot_id() {
  [ -r /proc/sys/kernel/random/boot_id ] || fail "Linux boot ID is unavailable."
  tr -d '\r\n' < /proc/sys/kernel/random/boot_id
}

active_helper() {
  local operation_id=$1
  docker ps -q --filter "label=com.initpad.platform-update=$operation_id" | head -1
}

assert_no_helper() {
  [ -z "$(docker ps -q --filter label=com.initpad.platform-update)" ] || \
    fail "A platform update helper is still running."
}

assert_checkpoint() {
  [ -f "$CHECKPOINT" ] || fail "No platform update checkpoint exists; run prepare first."
  stable_version "$(checkpoint_value current_version)" || fail "Checkpoint current version is invalid."
  stable_version "$(checkpoint_value next_version)" || fail "Checkpoint next version is invalid."
}

assert_baseline_invariants() {
  local expected_version=$1 actual
  ./self-hosted-check.sh running
  actual=$(state_value currentVersion)
  [ "$actual" = "$expected_version" ] || \
    fail "Supervisor reports platform $actual, expected $expected_version."
  actual=$(database_identity)
  [ "$actual" = "$(checkpoint_value database_identity)" ] || \
    fail "User, workspace or project identity changed during the platform update drill."
  actual=$(managed_workload_snapshot)
  [ "$actual" = "$(checkpoint_value workload_snapshot)" ] || \
    fail "A managed workload was recreated or changed during the platform update drill."
}

assert_previous_release_restored() {
  local actual
  assert_baseline_invariants "$(checkpoint_value current_version)"
  assert_supervisor_helper_image_available
  actual=$(runtime_override_sha256)
  [ "$actual" = "$(checkpoint_value override_sha256)" ] || \
    fail "The previous platform release descriptor was not restored exactly."
  assert_no_helper
}

write_checkpoint() {
  local current=${1:-} next=${2:-} actual operation_status temporary
  [ -n "$current" ] && [ -n "$next" ] || { usage >&2; exit 1; }
  validate_transition "$current" "$next"
  ensure_runtime
  assert_no_helper
  ./self-hosted-check.sh running
  assert_supervisor_helper_image_available
  actual=$(state_value currentVersion)
  [ "$actual" = "$current" ] || fail "Supervisor reports platform $actual, expected $current."
  operation_status=$(state_value operation.status || true)
  case "$operation_status" in ''|succeeded|failed|rolled-back) ;;
    *) fail "Platform operation is already $operation_status." ;;
  esac
  temporary=$(mktemp "$ACCEPTANCE_DIR/platform-update.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'current_version=%s\n' "$current"
    printf 'next_version=%s\n' "$next"
    printf 'database_identity=%s\n' "$(database_identity)"
    printf 'users=%s\n' "$(database_scalar 'SELECT count(*) FROM "User";')"
    printf 'workspaces=%s\n' "$(database_scalar 'SELECT count(*) FROM "Workspace";')"
    printf 'projects=%s\n' "$(database_scalar 'SELECT count(*) FROM "Project";')"
    printf 'workload_count=%s\n' "$(managed_workload_count)"
    printf 'workload_snapshot=%s\n' "$(managed_workload_snapshot)"
    printf 'override_sha256=%s\n' "$(runtime_override_sha256)"
  } > "$temporary"
  mv "$temporary" "$CHECKPOINT"
  rm -f "$REBOOT_CHECKPOINT"
  record platform-update-prepare \
    "from=$current to=$next workloads=$(checkpoint_value workload_count)"
  pass "Platform update baseline $current → $next is saved."
}

wait_for_candidate_api() {
  local previous_id operation_id status stage candidate current helper deadline
  previous_id=$(state_value operation.id || true)
  deadline=$((SECONDS + 900))
  say "Waiting for a new update. Click Install update in InitPad now." >&2
  while [ "$SECONDS" -lt "$deadline" ]; do
    operation_id=$(state_value operation.id || true)
    status=$(state_value operation.status || true)
    stage=$(state_value operation.stage || true)
    if [ -n "$operation_id" ] && [ "$operation_id" != "$previous_id" ]; then
      case "$status" in failed|rolled-back|succeeded)
        fail "Update reached terminal status '$status' before fault injection." ;;
      esac
      if [ "$stage" = api ]; then
        candidate=$(override_image api)
        current=$(container_image api 2>/dev/null || true)
        helper=$(active_helper "$operation_id")
        if [ -n "$candidate" ] && [ "$current" = "$candidate" ] && [ -n "$helper" ]; then
          printf '%s\n' "$operation_id"
          return 0
        fi
      elif [ "$stage" = web ] || [ "$stage" = supervisor ]; then
        fail "The updater advanced past the API stage before it could be paused."
      fi
    fi
    sleep 0.2
  done
  fail "No candidate API appeared within 15 minutes."
}

pause_helper_at_api() {
  local operation_id=$1 helper stage
  helper=$(active_helper "$operation_id")
  [ -n "$helper" ] || fail "The update helper disappeared before fault injection."
  docker pause "$helper" >/dev/null
  stage=$(state_value operation.stage || true)
  if [ "$stage" != api ]; then
    docker unpause "$helper" >/dev/null 2>&1 || true
    fail "The updater left the API stage before it was safely paused."
  fi
  printf '%s\n' "$helper"
}

wait_for_terminal_operation() {
  local operation_id=$1 expected=$2 status deadline
  deadline=$((SECONDS + 240))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(state_value operation.id || true)" = "$operation_id" ]; then
      status=$(state_value operation.status || true)
      [ "$status" = "$expected" ] && return 0
      case "$status" in failed|succeeded|rolled-back)
        fail "Update finished as '$status', expected '$expected'." ;;
      esac
    fi
    sleep 1
  done
  fail "Update did not reach '$expected' within four minutes."
}

fault_rollback() {
  local operation_id helper api_id
  assert_checkpoint
  assert_previous_release_restored
  operation_id=$(wait_for_candidate_api)
  helper=$(pause_helper_at_api "$operation_id")
  PAUSED_HELPER=$helper
  api_id=$(container_id api)
  say "Stopping only the signed candidate API to exercise health-gated rollback."
  if ! docker stop -t 0 "$api_id" >/dev/null; then
    docker unpause "$helper" >/dev/null 2>&1 || true
    fail "Could not stop the candidate API."
  fi
  docker unpause "$helper" >/dev/null || fail "Could not resume the update helper."
  PAUSED_HELPER=
  wait_for_terminal_operation "$operation_id" rolled-back
  pass "Candidate failure was detected and automatic rollback completed."
}

check_after_rollback() {
  local status
  assert_checkpoint
  status=$(state_value operation.status || true)
  [ "$status" = rolled-back ] || fail "Latest platform update status is '$status', not rolled-back."
  assert_previous_release_restored
  record platform-update-rollback \
    "version=$(checkpoint_value current_version) identity_preserved=true workloads_preserved=true"
  pass "Failed candidate rollback preserved the previous release, data and workloads."
}

interrupt_reboot() {
  local operation_id helper temporary
  assert_checkpoint
  assert_previous_release_restored
  say "Validating sudo before the update starts."
  sudo -v || fail "sudo authentication failed."
  operation_id=$(wait_for_candidate_api)
  helper=$(pause_helper_at_api "$operation_id")
  PAUSED_HELPER=$helper
  temporary=$(mktemp "$ACCEPTANCE_DIR/platform-update-reboot.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'boot_id=%s\n' "$(boot_id)"
    printf 'operation_id=%s\n' "$operation_id"
    printf 'helper_id=%s\n' "$helper"
  } > "$temporary"
  mv "$temporary" "$REBOOT_CHECKPOINT"
  sync
  say "Updater paused during API cutover; rebooting the disposable host now."
  # A successful reboot must leave the no-restart helper paused/stopped so the
  # restarted Supervisor detects an orphaned operation and rolls it back.
  PAUSED_HELPER=
  if ! sudo systemctl reboot; then
    rm -f "$REBOOT_CHECKPOINT"
    docker unpause "$helper" >/dev/null 2>&1 || true
    fail "Host reboot could not be started."
  fi
  sleep 30
  rm -f "$REBOOT_CHECKPOINT"
  docker unpause "$helper" >/dev/null 2>&1 || true
  fail "The reboot command returned without rebooting the host."
}

check_after_reboot() {
  local previous_boot current_boot operation_id status message
  assert_checkpoint
  [ -f "$REBOOT_CHECKPOINT" ] || \
    fail "No interrupted-update reboot checkpoint exists; run interrupt-reboot first."
  previous_boot=$(checkpoint_value boot_id "$REBOOT_CHECKPOINT")
  current_boot=$(boot_id)
  [ -n "$previous_boot" ] && [ "$previous_boot" != "$current_boot" ] || \
    fail "The Linux boot ID did not change."
  operation_id=$(checkpoint_value operation_id "$REBOOT_CHECKPOINT")
  [ "$(state_value operation.id || true)" = "$operation_id" ] || \
    fail "Supervisor recovered a different platform operation."
  status=$(state_value operation.status || true)
  [ "$status" = rolled-back ] || \
    fail "Interrupted update recovered as '$status', expected rolled-back."
  message=$(state_value operation.message || true)
  printf '%s\n' "$message" | grep -qi 'interrupted.*rolled back' || \
    fail "Supervisor did not record interrupted-update recovery."
  assert_previous_release_restored
  rm -f "$REBOOT_CHECKPOINT"
  record platform-update-reboot-recovery \
    "version=$(checkpoint_value current_version) boot_changed=true identity_preserved=true"
  pass "Host reboot during cutover rolled back safely and preserved data and workloads."
}

check_after_success() {
  local expected status to_version references
  assert_checkpoint
  expected=$(checkpoint_value next_version)
  status=$(state_value operation.status || true)
  to_version=$(state_value operation.toVersion || true)
  [ "$status" = succeeded ] || fail "Latest platform update status is '$status', not succeeded."
  [ "$to_version" = "$expected" ] || fail "Latest update targeted '$to_version', expected '$expected'."
  assert_baseline_invariants "$expected"
  references=$(grep -Ec 'image: ".+@sha256:[a-f0-9]{64}"' "$OVERRIDE" || true)
  [ "$references" -eq 3 ] || fail "Installed release descriptor is not fully immutable."
  assert_no_helper
  record platform-update-success \
    "version=$expected identity_preserved=true workloads_preserved=true signed_release=true"
  rm -f "$CHECKPOINT" "$REBOOT_CHECKPOINT"
  pass "Signed platform $expected update preserved data and managed workloads."
}

case "${1:-}" in
  prepare) [ "$#" -eq 3 ] || { usage >&2; exit 1; }; write_checkpoint "$2" "$3" ;;
  fault-rollback) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; ensure_runtime; fault_rollback ;;
  after-rollback) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; ensure_runtime; check_after_rollback ;;
  interrupt-reboot) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; ensure_runtime; interrupt_reboot ;;
  after-reboot) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; ensure_runtime; check_after_reboot ;;
  after-success) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; ensure_runtime; check_after_success ;;
  -h|--help|'') usage ;;
  *) usage >&2; exit 1 ;;
esac
