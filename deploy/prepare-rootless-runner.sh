#!/usr/bin/env bash
# Install the narrow AppArmor exception required by rootless Docker-in-Docker
# on Ubuntu 24.04 and newer. The global user-namespace restriction stays on.
set -euo pipefail

PROFILE=/etc/apparmor.d/usr.local.bin.rootlesskit
RESTRICTION=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
MARKER='# Managed by InitPad for the isolated rootless CI daemon.'

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail "This host preparation is only for Linux."

if [ ! -e "$RESTRICTION" ] || [ "$(cat "$RESTRICTION")" != 1 ]; then
  pass "The host does not require the Ubuntu RootlessKit AppArmor exception."
  exit 0
fi

[ "$(id -u)" -eq 0 ] || \
  fail "Run this command with sudo: sudo ./prepare-rootless-runner.sh"
command -v apparmor_parser >/dev/null 2>&1 || \
  fail "apparmor_parser is missing; install the Ubuntu 'apparmor' package."

compatible_profile() {
  [ -f "$PROFILE" ] &&
    grep -Eq '^[[:space:]]*/usr/local/bin/rootlesskit[[:space:]]+flags=\(unconfined\)' "$PROFILE" &&
    grep -Eq '^[[:space:]]*userns,[[:space:]]*$' "$PROFILE"
}

if [ -e "$PROFILE" ] && ! compatible_profile; then
  fail "$PROFILE already exists but does not contain the required RootlessKit userns rule; review it manually."
fi

if [ ! -e "$PROFILE" ]; then
  temporary=$(mktemp)
  trap 'rm -f "$temporary"' EXIT
  cat > "$temporary" <<EOF
$MARKER
abi <abi/4.0>,
include <tunables/global>

/usr/local/bin/rootlesskit flags=(unconfined) {
  userns,

  include if exists <local/usr.local.bin.rootlesskit>
}
EOF
  install -o root -g root -m 0644 "$temporary" "$PROFILE"
fi

apparmor_parser -r "$PROFILE"
pass "RootlessKit AppArmor profile is installed and loaded; the global restriction remains enabled."
