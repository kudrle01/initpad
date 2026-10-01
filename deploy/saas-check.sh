#!/bin/sh
set -eu

cd "$(dirname "$0")"

env_file=${1:-.env.saas}
[ -r "$env_file" ] || {
  echo "Missing $env_file. Start from .env.saas.example and configure secret file paths." >&2
  exit 1
}

compose() {
  docker compose --env-file "$env_file" -f saas.compose.yml "$@"
}

# `config --quiet` expands and validates the complete model without printing
# its environment. Secret values remain in read-only mounted files.
compose config --quiet

services=$(compose config --services | LC_ALL=C sort)
[ "$services" = "api
web" ] || {
  echo "SaaS profile must contain only api and web; got: $services" >&2
  exit 1
}

images=$(compose config --images)
count=0
for image in $images; do
  count=$((count + 1))
  case "$image" in
    *@sha256:????????????????????????????????????????????????????????????????) ;;
    *)
      echo "SaaS image is not digest-pinned: $image" >&2
      exit 1
      ;;
  esac
done
[ "$count" -eq 2 ] || {
  echo "Expected exactly two SaaS images, got $count" >&2
  exit 1
}

echo "SaaS Compose contract is valid: api + web, external dependencies, immutable images."
