#!/usr/bin/env bash
# Reclaim disk safely (ADR-062). Removes dangling images and the Docker build
# cache only. It NEVER touches named data volumes (pgdata, minio-data,
# gitea-data, api-data, …) or images backing a running deployment, so it is safe
# to run on a schedule. Verified build artifacts in object storage are pruned
# separately by the platform's own retention (ADR-059).
#
#   ./cleanup.sh
set -euo pipefail

say() { printf '\033[1;32m›\033[0m %s\n' "$*"; }

say "Disk usage before:"
docker system df || true

say "Pruning dangling images"
docker image prune -f

say "Pruning build cache"
docker builder prune -f

say "Disk usage after:"
docker system df || true

printf '\033[1;32m✔\033[0m Cleanup complete. Data volumes and running deployments were left untouched.\n'
