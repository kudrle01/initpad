#!/usr/bin/env bash
# Reclaim disk safely (ADR-062). Removes dangling images and the Docker build
# cache only. It NEVER touches named data volumes (pgdata, minio-data,
# gitea-data, api-data, …) or images backing a running deployment, so it is safe
# to run on a schedule. Verified build artifacts in object storage are pruned
# separately by the platform's own retention (ADR-059).
#
#   ./cleanup.sh
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# A long-running container can outlive its local image metadata on some Docker
# storage backends. The source installation's Supervisor must be able to start
# a short-lived, privileged update helper from exactly its own image. Reapply
# the configured :source tag before pruning so that image is never dangling.
protect_source_image() {
  local service=$1 container configured image_id
  container=$(docker compose --profile runner --profile server ps -q "$service" 2>/dev/null || true)
  [ -n "$container" ] || return 0
  configured=$(docker inspect --format '{{.Config.Image}}' "$container")
  case "$configured" in
    *:source)
      image_id=$(docker inspect --format '{{.Image}}' "$container")
      docker image inspect "$image_id" >/dev/null 2>&1 || \
        fail "Active $service source image $image_id is already missing. Rebuild the exact installed version before cleanup."
      docker image tag "$image_id" "$configured"
      say "Protected active source image $configured"
      ;;
  esac
}

for service in api web supervisor; do
  protect_source_image "$service"
done

say "Disk usage before:"
docker system df || true

say "Pruning dangling images"
docker image prune -f

say "Pruning build cache"
docker builder prune -f

say "Disk usage after:"
docker system df || true

printf '\033[1;32m✔\033[0m Cleanup complete. Data volumes and running deployments were left untouched.\n'
