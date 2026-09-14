#!/bin/sh
# Fill an unconfigured deploy/.env with the reviewed Agent release pair.
# Existing complete pairs are preserved so upgrades never silently switch a
# deliberately pinned Agent release.
set -eu

cd "$(dirname "$0")"

ENV_FILE=${INITPAD_ENV_FILE:-.env}
RELEASE_FILE=${INITPAD_AGENT_RELEASE_FILE:-agent-release.env}

fail() {
  printf 'Agent release configuration failed: %s\n' "$*" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || fail "$ENV_FILE does not exist"
[ -f "$RELEASE_FILE" ] || fail "$RELEASE_FILE does not exist"

get_value() {
  awk -F= -v key="$2" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$1"
}

set_value() {
  file=$1
  key=$2
  value=$3
  directory=$(dirname "$file")
  temporary=$(mktemp "$directory/.initpad-env.XXXXXX")
  trap 'rm -f "${temporary:-}"' EXIT HUP INT TERM
  awk -v key="$key" -v value="$value" '
    BEGIN { FS = OFS = "=" }
    $1 == key { $0 = key "=" value; found = 1 }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$file"
  temporary=
  trap - EXIT HUP INT TERM
}

release_image=$(get_value "$RELEASE_FILE" INITPAD_AGENT_IMAGE)
release_version=$(get_value "$RELEASE_FILE" INITPAD_AGENT_RELEASE_VERSION)

printf '%s\n' "$release_image" | grep -Eq '^[^[:space:]]+@sha256:[0-9a-f]{64}$' ||
  fail "INITPAD_AGENT_IMAGE in $RELEASE_FILE is not an immutable OCI digest"
printf '%s\n' "$release_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
  fail "INITPAD_AGENT_RELEASE_VERSION in $RELEASE_FILE is not a stable semantic version"

current_image=$(get_value "$ENV_FILE" INITPAD_AGENT_IMAGE)
current_version=$(get_value "$ENV_FILE" INITPAD_AGENT_RELEASE_VERSION)

if [ -z "$current_image" ] && [ -z "$current_version" ]; then
  set_value "$ENV_FILE" INITPAD_AGENT_IMAGE "$release_image"
  set_value "$ENV_FILE" INITPAD_AGENT_RELEASE_VERSION "$release_version"
  printf 'Configured reviewed InitPad Agent %s.\n' "$release_version"
elif [ -z "$current_image" ] || [ -z "$current_version" ]; then
  fail "INITPAD_AGENT_IMAGE and INITPAD_AGENT_RELEASE_VERSION must be configured together"
else
  printf '%s\n' "$current_image" | grep -Eq '^[^[:space:]]+@sha256:[0-9a-f]{64}$' ||
    fail "INITPAD_AGENT_IMAGE in $ENV_FILE is not an immutable OCI digest"
  printf '%s\n' "$current_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
    fail "INITPAD_AGENT_RELEASE_VERSION in $ENV_FILE is not a stable semantic version"
  printf 'Keeping explicitly configured InitPad Agent %s.\n' "$current_version"
fi
