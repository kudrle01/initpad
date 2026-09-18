#!/usr/bin/env bash
# Verified recovery installer for a downloaded InitPad platform release.
# Normal updates are started in the Admin UI and executed by the Supervisor.
# This script is the explicit operator fallback when the control plane is down.
set -euo pipefail

say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./initpad-install-release.sh --project-root /absolute/path/to/initpad

Run this command from the extracted GitHub release directory containing
SHA256SUMS, SHA256SUMS.sigstore.json and the release assets.
EOF
}

PROJECT_ROOT=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-root) PROJECT_ROOT=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[ -n "$PROJECT_ROOT" ] || { usage >&2; exit 1; }
case "$PROJECT_ROOT" in /*) ;; *) fail "--project-root must be an absolute path.";; esac

RELEASE_DIR=$(pwd -P)
PROJECT_ROOT=$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P) || fail "Project root does not exist."
DEPLOY_DIR=$PROJECT_ROOT/deploy
[ -f "$DEPLOY_DIR/docker-compose.yml" ] || fail "Project root has no deploy/docker-compose.yml."
[ -f "$DEPLOY_DIR/.env" ] || fail "Project root has no deploy/.env."
for file in SHA256SUMS SHA256SUMS.sigstore.json initpad-platform-release.json \
  initpad-release.override.yml; do
  [ -f "$RELEASE_DIR/$file" ] || fail "Release asset '$file' is missing."
done
command -v docker >/dev/null || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."
[ -z "$(docker ps -q --filter label=com.initpad.platform-update)" ] || \
  fail "Another signed platform update is currently running."
command -v cosign >/dev/null || \
  fail "cosign is required to verify this release (https://docs.sigstore.dev/cosign/system_config/installation/)."

VERSION=$(awk -F'"' '$2 == "version" { print $4; exit }' initpad-platform-release.json)
printf '%s\n' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || \
  fail "Release manifest contains an invalid version."
IDENTITY="https://github.com/kudrle01/initpad/.github/workflows/release-platform.yml@refs/tags/initpad-v$VERSION"

say "Verifying the official signed checksum manifest"
cosign verify-blob \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "$IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS >/dev/null

say "Verifying every release asset"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --strict -c SHA256SUMS
  OVERRIDE_SHA256=$(sha256sum initpad-release.override.yml | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c SHA256SUMS
  OVERRIDE_SHA256=$(shasum -a 256 initpad-release.override.yml | awk '{print $1}')
else
  fail "Neither sha256sum nor shasum is installed."
fi
MANIFEST_OVERRIDE_SHA256=$(awk -F'"' '$2 == "sha256" { print $4; exit }' \
  initpad-platform-release.json)
[ "$OVERRIDE_SHA256" = "$MANIFEST_OVERRIDE_SHA256" ] || \
  fail "Release Compose descriptor does not match the signed manifest."

RUNTIME_DIR=$DEPLOY_DIR/.runtime/platform-update
OVERRIDE=$RUNTIME_DIR/platform-release.override.yml
PREVIOUS=$RUNTIME_DIR/platform-release.override.previous-$$
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
had_previous=no
if [ -f "$OVERRIDE" ]; then
  cp "$OVERRIDE" "$PREVIOUS"
  chmod 600 "$PREVIOUS"
  had_previous=yes
fi

COMPOSE_BASE=(docker compose --project-directory "$DEPLOY_DIR" --env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/docker-compose.yml")
compose_candidate() { "${COMPOSE_BASE[@]}" -f "$OVERRIDE" "$@"; }
compose_previous() {
  if [ "$had_previous" = yes ]; then
    "${COMPOSE_BASE[@]}" -f "$PREVIOUS" "$@"
  else
    "${COMPOSE_BASE[@]}" "$@"
  fi
}
wait_healthy() {
  local service=$1 id status
  for _ in $(seq 1 60); do
    id=$(compose_candidate ps -q "$service" 2>/dev/null || true)
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)
    [ "$status" = healthy ] && return 0
    case "$status" in unhealthy|exited|dead) fail "$service became $status.";; esac
    sleep 2
  done
  fail "$service did not become healthy in time."
}

applied=no
rollback() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$applied" = yes ]; then
    printf '\033[1;33m›\033[0m Restoring the previous platform images...\n' >&2
    if [ "$had_previous" = yes ]; then cp "$PREVIOUS" "$OVERRIDE"; else rm -f "$OVERRIDE"; fi
    compose_previous up -d --no-deps --no-build api web supervisor >/dev/null 2>&1 || true
  fi
  rm -f "$PREVIOUS"
  exit "$status"
}
trap rollback EXIT

say "Creating a complete pre-update backup"
(cd "$DEPLOY_DIR" && ./backup.sh)

cp "$RELEASE_DIR/initpad-release.override.yml" "$OVERRIDE"
chmod 600 "$OVERRIDE"
applied=yes
say "Pulling immutable release images"
compose_candidate pull api web supervisor

say "Updating API and applying compatible migrations"
compose_candidate up -d --no-deps --no-build api
wait_healthy api
say "Updating web UI"
compose_candidate up -d --no-deps --no-build web
wait_healthy web
say "Updating release Supervisor"
compose_candidate up -d --no-deps --no-build supervisor
wait_healthy supervisor
say "Recording the verified recovery release"
compose_candidate exec -T supervisor node dist/cli.js adopt-current-release --version "$VERSION"

applied=no
rm -f "$PREVIOUS"
trap - EXIT
printf '\033[1;32m✔\033[0m InitPad %s installed and verified.\n' "$VERSION"
