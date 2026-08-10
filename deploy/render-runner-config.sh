#!/usr/bin/env bash
# Validate the complete bundled-runner resource policy and render act_runner's
# configuration from the checked-in safe baseline. The runner does not expand
# environment variables inside YAML, so the installer performs the one
# controlled substitution before Compose starts it.
set -euo pipefail
cd "$(dirname "$0")"

fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
get_env() {
  [ -f .env ] || return 0
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env
}

capacity=$(get_env INITPAD_RUNNER_CAPACITY)
capacity=${capacity:-1}
case "$capacity" in
  ''|*[!0-9]*) fail "INITPAD_RUNNER_CAPACITY must be an integer from 1 to 8." ;;
esac
[ "$capacity" -ge 1 ] && [ "$capacity" -le 8 ] || \
  fail "INITPAD_RUNNER_CAPACITY must be between 1 and 8."

memory_limit=$(get_env INITPAD_RUNNER_MEMORY_LIMIT)
memory_limit=${memory_limit:-1536m}
printf '%s\n' "$memory_limit" | grep -Eq '^[1-9][0-9]*(m|g)$' || \
  fail "INITPAD_RUNNER_MEMORY_LIMIT must use a positive m/g value (for example 1536m or 2g)."

cpu_limit=$(get_env INITPAD_RUNNER_CPU_LIMIT)
cpu_limit=${cpu_limit:-1.0}
printf '%s\n' "$cpu_limit" | grep -Eq '^[0-9]+([.][0-9]+)?$' || \
  fail "INITPAD_RUNNER_CPU_LIMIT must be a positive number (for example 1.0 or 2)."
awk -v value="$cpu_limit" 'BEGIN { exit !(value > 0 && value <= 64) }' || \
  fail "INITPAD_RUNNER_CPU_LIMIT must be greater than 0 and no more than 64."

pids_limit=$(get_env INITPAD_RUNNER_PIDS_LIMIT)
pids_limit=${pids_limit:-512}
case "$pids_limit" in
  ''|*[!0-9]*) fail "INITPAD_RUNNER_PIDS_LIMIT must be an integer from 64 to 4096." ;;
esac
[ "$pids_limit" -ge 64 ] && [ "$pids_limit" -le 4096 ] || \
  fail "INITPAD_RUNNER_PIDS_LIMIT must be between 64 and 4096."

source_config=../infra/act_runner/config.yaml
runtime_dir=.runtime
target_config=$runtime_dir/act-runner-config.yaml
change_marker=$runtime_dir/runner-config.changed
[ -f "$source_config" ] || fail "Runner configuration baseline is missing."
[ "$(grep -c '^  capacity: [0-9][0-9]*$' "$source_config")" -eq 1 ] || \
  fail "Runner configuration must contain exactly one numeric capacity setting."

mkdir -p "$runtime_dir"
tmp=$(mktemp "$runtime_dir/act-runner-config.XXXXXX")
trap 'rm -f "$tmp"' EXIT
sed "s/^  capacity: [0-9][0-9]*$/  capacity: $capacity/" "$source_config" > "$tmp"
chmod 644 "$tmp"
if [ -f "$target_config" ] && cmp -s "$tmp" "$target_config"; then
  rm -f "$tmp"
  trap - EXIT
  exit 0
fi
mv "$tmp" "$target_config"
trap - EXIT
: > "$change_marker"
