#!/usr/bin/env bash
# Render the act_runner configuration from the checked-in safe baseline. The
# runner does not expand environment variables inside its YAML config, so the
# installer performs the one controlled substitution before Compose starts it.
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
