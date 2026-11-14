#!/usr/bin/env bash
# Complete wipe of the InitPad stack: containers (all profiles), volumes,
# networks, the apps InitPad deployed on this host (containers, their networks
# and images), the built platform images, the generated .env and .runtime.
# ALL platform data is lost — repositories, projects, database. Use before a
# fresh ./install.sh.
#
#   ./reset.sh          asks for confirmation
#   ./reset.sh --yes    no question (scripts)
#
# Agent servers are not touched: uninstall the Agent there.
set -euo pipefail
cd "$(dirname "$0")"

answer=
case "${1:-}" in
  --yes|-y) answer=y ;;
  '') ;;
  *) echo "Usage: $0 [--yes]" >&2; exit 2 ;;
esac
if [ -z "$answer" ]; then
  read -r -p "This deletes ALL InitPad data (repos, projects, database) and the apps it deployed on this host. Continue? [y/N] " answer
fi
case "${answer:-n}" in y|Y|yes) ;; *) echo "Aborted."; exit 0 ;; esac

get_env() { [ -f .env ] && awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env || true; }
registry_host=$(get_env INITPAD_REGISTRY_HOST)

# Apps deployed to the built-in Docker server publish ports on this host and
# would keep running after the platform is gone.
managed=$(docker ps -aq --filter label=com.initpad.managed=true)
if [ -n "$managed" ]; then
  echo "Removing $(printf '%s\n' "$managed" | wc -l | tr -d ' ') deployed app container(s)"
  # shellcheck disable=SC2086
  docker rm -f $managed >/dev/null
fi

docker compose --profile runner --profile server down -v --remove-orphans || true
# A runner left over from the development stack before it got its own project
# name (infra/, profile "ci") keeps the shared network alive.
docker rm -f initpad-act_runner-1 >/dev/null 2>&1 || true
docker network rm initpad_platform >/dev/null 2>&1 || true

# Per-environment networks the API created: labelled ones, and older unlabelled
# ones by their exact naming scheme (net-<env> / net-<workspace>-<env>). Docker
# refuses to remove a network that still has containers, so nothing foreign
# that is in use can be removed.
networks=$( {
  docker network ls -q --filter label=com.initpad.managed=true
  docker network ls --format '{{.ID}} {{.Name}}' |
    awk '$2 ~ /^net-([a-z0-9-]+-)?(dev|test|prod)$/ { print $1 }'
} | sort -u)
for network in $networks; do
  docker network rm "$network" >/dev/null 2>&1 || true
done

# Images of deployed apps (built locally or pulled from this Gitea registry)
# and the platform images built from this checkout.
images=$(docker image ls --format '{{.Repository}}:{{.Tag}}' | awk -v registry="$registry_host" '
  /^initpad\// { print; next }
  /^initpad-(api|web|supervisor):source$/ { print; next }
  registry != "" && index($0, registry "/") == 1 { print }
')
for image in $images; do
  docker image rm -f "$image" >/dev/null 2>&1 || true
done

rm -f .env
rm -rf .runtime 2>/dev/null || echo "Could not remove deploy/.runtime completely; remove it as root." >&2

echo "Clean. Run ./install.sh for a fresh install."
