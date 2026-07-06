#!/usr/bin/env bash
# Complete wipe of the InitPad stack: containers (all profiles), volumes,
# networks and the generated .env. ALL platform data is lost — repositories,
# projects, database. Use before a fresh ./install.sh.
set -euo pipefail
cd "$(dirname "$0")"

read -r -p "This deletes ALL InitPad data (repos, projects, database). Continue? [y/N] " answer
case "${answer:-n}" in y|Y|yes) ;; *) echo "Aborted."; exit 0 ;; esac

docker compose --profile runner --profile server down -v --remove-orphans || true
# A runner left over from the development stack (infra/, profile "ci") keeps
# the shared network alive — remove it explicitly.
docker rm -f initpad-act_runner-1 >/dev/null 2>&1 || true
docker network rm initpad_platform >/dev/null 2>&1 || true
rm -f .env

echo "Clean. Run ./install.sh for a fresh install."
