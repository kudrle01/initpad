#!/bin/sh
# Fill an unconfigured deploy/.env with the reviewed Agent release pair.
# Existing complete pairs are preserved so upgrades never silently switch a
# deliberately pinned Agent release.
set -eu

cd "$(dirname "$0")"

ENV_FILE=${INITPAD_ENV_FILE:-.env}
RELEASE_FILE=${INITPAD_AGENT_RELEASE_FILE:-agent-release.env}
MODE=${1:-preserve}

fail() {
  printf 'Agent release configuration failed: %s\n' "$*" >&2
  exit 1
}

case "$MODE" in
  preserve|--update) ;;
  *) fail "usage: $0 [--update]" ;;
esac

[ -f "$ENV_FILE" ] || fail "$ENV_FILE does not exist"
[ -f "$RELEASE_FILE" ] || fail "$RELEASE_FILE does not exist"

get_value() {
  awk -F= -v key="$2" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$1"
}

set_release_pair() {
  file=$1
  image=$2
  version=$3
  directory=$(dirname "$file")
  temporary=$(mktemp "$directory/.initpad-env.XXXXXX")
  trap 'rm -f "${temporary:-}"' EXIT HUP INT TERM
  awk -v image="$image" -v version="$version" '
    BEGIN { FS = OFS = "=" }
    $1 == "INITPAD_AGENT_IMAGE" {
      if (!image_found) print "INITPAD_AGENT_IMAGE=" image
      image_found = 1
      next
    }
    $1 == "INITPAD_AGENT_RELEASE_VERSION" {
      if (!version_found) print "INITPAD_AGENT_RELEASE_VERSION=" version
      version_found = 1
      next
    }
    { print }
    END {
      if (!image_found) print "INITPAD_AGENT_IMAGE=" image
      if (!version_found) print "INITPAD_AGENT_RELEASE_VERSION=" version
    }
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

if [ "$MODE" = "--update" ]; then
  if [ "$current_image" = "$release_image" ] && [ "$current_version" = "$release_version" ]; then
    printf 'Reviewed InitPad Agent %s is already configured.\n' "$release_version"
  else
    set_release_pair "$ENV_FILE" "$release_image" "$release_version"
    printf 'Updated reviewed InitPad Agent release to %s.\n' "$release_version"
  fi
elif [ -z "$current_image" ] && [ -z "$current_version" ]; then
  set_release_pair "$ENV_FILE" "$release_image" "$release_version"
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
