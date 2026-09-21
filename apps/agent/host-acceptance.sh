#!/usr/bin/env bash
# Evidence helper for the Agent disconnect/reconnect acceptance. The operator
# stops and starts the Agent explicitly; this script only verifies state.
set -euo pipefail

AGENT_CONTAINER=${INITPAD_AGENT_CONTAINER:-initpad-agent}
PROGRAM=${0##*/}
CONFIG_FILE=${INITPAD_AGENT_CONFIG_FILE:-/var/lib/initpad-agent/agent.json}
ACCEPTANCE_DIR=${INITPAD_AGENT_ACCEPTANCE_DIR:-/var/lib/initpad-agent/acceptance}
CHECKPOINT=$ACCEPTANCE_DIR/disconnect.checkpoint
REPORT=$ACCEPTANCE_DIR/results.tsv

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  printf 'Usage: sudo ./%s <command>\n\n' "$PROGRAM"
  cat <<'EOF'
  before-disconnect  Verify Agent/workloads and save their identities
  disconnected       Prove workloads stayed running while Agent is stopped
  after-reconnect    Prove the same Agent identity and workloads recovered

The script never stops, starts or replaces a container. Results are stored
root-only in /var/lib/initpad-agent/acceptance/results.tsv. It never prints or
copies the Agent credential.
EOF
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Run this acceptance helper with sudo."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is missing."
}

ensure_storage() {
  install -d -m 0700 "$ACCEPTANCE_DIR"
  touch "$REPORT"
  chmod 0600 "$REPORT"
}

record() {
  ensure_storage
  printf '%s\t%s\tPASS\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$REPORT"
}

config_value() {
  local key=$1
  sed -n 's/^[[:space:]]*"'"$key"'":[[:space:]]*"\{0,1\}\([^",]*\)"\{0,1\},\{0,1\}[[:space:]]*$/\1/p' \
    "$CONFIG_FILE" | head -1
}

container_running() {
  docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true
}

agent_target_id() {
  local target_id
  target_id=$(config_value targetId)
  [ -n "$target_id" ] || fail "Agent identity has no readable targetId."
  printf '%s\n' "$target_id"
}

agent_identity() {
  local agent_id generation target_id
  target_id=$(agent_target_id)
  agent_id=$(config_value agentId)
  generation=$(config_value credentialGeneration)
  [ -n "$agent_id" ] || fail "Agent identity has no readable agentId."
  case "$generation" in
    ''|*[!0-9]*) fail "Agent identity has no readable credential generation." ;;
  esac
  printf '%s|%s|%s\n' "$target_id" "$agent_id" "$generation"
}

workload_ids() {
  local target_id=$1
  docker ps -aq \
    --filter label=com.initpad.managed=true \
    --filter "label=com.initpad.target=$target_id" | sort
}

assert_agent_managed() {
  local managed
  managed=$(docker inspect --format '{{index .Config.Labels "com.initpad.agent"}}' \
    "$AGENT_CONTAINER" 2>/dev/null || true)
  [ "$managed" = true ] || fail "'$AGENT_CONTAINER' is missing or is not an InitPad Agent container."
}

assert_workloads_running() {
  local ids=$1 id count=0
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    [ "$(container_running "$id")" = true ] || fail "Workload '$id' is not running."
    count=$((count + 1))
  done <<< "$ids"
  [ "$count" -gt 0 ] || fail "Deploy at least one workload to this target first."
}

checkpoint_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$CHECKPOINT"
}

checkpoint_workloads() {
  sed -n 's/^workload=//p' "$CHECKPOINT" | sort
}

assert_checkpoint() {
  [ -f "$CHECKPOINT" ] || fail "No checkpoint exists; run before-disconnect first."
  [ "$(stat -c '%a' "$CHECKPOINT")" = 600 ] || fail "Acceptance checkpoint permissions are not 0600."
}

assert_identity_unchanged() {
  local expected actual
  expected=$(checkpoint_value identity)
  actual=$(agent_identity)
  [ "$actual" = "$expected" ] || fail "Agent identity or credential generation changed."
}

assert_workloads_preserved() {
  local target_id expected id managed labeled_target
  target_id=$(checkpoint_value target_id)
  expected=$(checkpoint_workloads)
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    [ "$(container_running "$id")" = true ] || fail "Original workload '$id' is not running."
    managed=$(docker inspect --format '{{index .Config.Labels "com.initpad.managed"}}' "$id")
    labeled_target=$(docker inspect --format '{{index .Config.Labels "com.initpad.target"}}' "$id")
    [ "$managed" = true ] && [ "$labeled_target" = "$target_id" ] || \
      fail "Original workload '$id' no longer belongs to the expected target."
  done <<< "$expected"
}

before_disconnect() {
  [ -f "$CONFIG_FILE" ] || fail "Agent identity '$CONFIG_FILE' does not exist."
  [ "$(stat -c '%a' "$CONFIG_FILE")" = 600 ] || fail "Agent identity permissions are not 0600."
  assert_agent_managed
  [ "$(container_running "$AGENT_CONTAINER")" = true ] || fail "Agent is not running."
  docker exec "$AGENT_CONTAINER" node /app/dist/cli.js once >/dev/null || \
    fail "Agent heartbeat was rejected before disconnect."

  local identity target_id agent_container_id ids temporary
  identity=$(agent_identity)
  target_id=${identity%%|*}
  agent_container_id=$(docker inspect --format '{{.Id}}' "$AGENT_CONTAINER")
  ids=$(workload_ids "$target_id")
  assert_workloads_running "$ids"

  ensure_storage
  temporary=$(mktemp "$ACCEPTANCE_DIR/disconnect.XXXXXX")
  chmod 0600 "$temporary"
  {
    printf 'identity=%s\n' "$identity"
    printf 'target_id=%s\n' "$target_id"
    printf 'agent_container=%s\n' "$agent_container_id"
    while IFS= read -r id; do
      [ -n "$id" ] && printf 'workload=%s\n' "$id"
    done <<< "$ids"
  } > "$temporary"
  mv "$temporary" "$CHECKPOINT"
  record before-disconnect "target=$target_id workloads=$(printf '%s\n' "$ids" | grep -c .)"
  pass "Checkpoint saved. Now run: sudo docker stop $AGENT_CONTAINER"
}

check_disconnected() {
  assert_checkpoint
  assert_agent_managed
  [ "$(container_running "$AGENT_CONTAINER")" = false ] || \
    fail "Agent is still running; stop only '$AGENT_CONTAINER' first."
  assert_identity_unchanged
  assert_workloads_preserved
  record disconnected "agent_stopped=true workloads_preserved=true"
  pass "Workloads remain running with the Agent disconnected."
  printf 'Now request Test protocol in InitPad; it must remain queued.\n'
  printf 'Then run: sudo docker start %s\n' "$AGENT_CONTAINER"
}

check_after_reconnect() {
  assert_checkpoint
  assert_agent_managed
  [ "$(container_running "$AGENT_CONTAINER")" = true ] || fail "Agent is not running."
  [ "$(docker inspect --format '{{.Id}}' "$AGENT_CONTAINER")" = \
    "$(checkpoint_value agent_container)" ] || fail "Agent container was replaced instead of restarted."
  assert_identity_unchanged
  assert_workloads_preserved
  docker exec "$AGENT_CONTAINER" node /app/dist/cli.js once >/dev/null || \
    fail "Agent heartbeat was rejected after reconnect."
  rm -f "$CHECKPOINT"
  record after-reconnect "identity_preserved=true workloads_preserved=true heartbeat=true"
  pass "Agent reconnected with the same identity and workloads."
  printf 'Confirm in InitPad that the queued protocol test completed exactly once.\n'
}

case "${1:-}" in
  -h|--help|'') usage; exit 0 ;;
  before-disconnect|disconnected|after-reconnect) ;;
  *) usage >&2; exit 1 ;;
esac

require_root
require_command docker
require_command awk
require_command sed
require_command sort
docker info >/dev/null 2>&1 || fail "Docker Engine is not reachable."

case "$1" in
  before-disconnect) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; before_disconnect ;;
  disconnected) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; check_disconnected ;;
  after-reconnect) [ "$#" -eq 1 ] || { usage >&2; exit 1; }; check_after_reconnect ;;
esac
