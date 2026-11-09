#!/bin/sh
# Entry point of runner-seed (ADR-168). Builds the image seed that every CI
# daemon loads right after its reset: the images are pulled by digest on a
# throw-away daemon and saved to one tar file in the runner-docker-seed volume.
# runner-docker mounts that volume read-only, so a job can neither add to the
# seed nor change it. Jobs never write here; only this installer-time service
# does, and it runs no job code.
set -eu

list=/opt/initpad-runner/seed-images
out=/seed

# Skip the pulls when the seed already holds exactly this list.
want=$(sha256sum "$list" | cut -d' ' -f1)
if [ -s "$out/images.tar" ] && [ "$(cat "$out/images.sha256" 2>/dev/null || :)" = "$want" ]; then
  echo "initpad: CI image seed is up to date"
  exit 0
fi

# The daemon runs on its own network (see docker-compose.yml), not on ci-control,
# so no job can reach its API and place an image in the seed. It pulls from the
# registry directly; a pull by digest verifies the content. The containerd image
# store matches runner-docker's, so the saved images are the ones a job would
# have pulled. The entry point adds the daemon's own TCP listener.
dockerd-entrypoint.sh --tls=false --feature=containerd-snapshotter=true &
daemon=$!
trap 'kill -TERM "$daemon" 2>/dev/null || :; wait "$daemon" 2>/dev/null || :' EXIT

tries=0
until docker info >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 120 ] || ! kill -0 "$daemon" 2>/dev/null; then
    echo >&2 'initpad: the seed daemon did not start'
    exit 1
  fi
  sleep 1
done

names=
while IFS= read -r ref; do
  case "$ref" in '' | '#'*) continue ;; esac
  case "$ref" in
    *:*@sha256:*) ;;
    *)
      echo >&2 "initpad: seed image must be repository:tag@sha256:digest, got: $ref"
      exit 1
      ;;
  esac
  docker pull -q "$ref" >/dev/null
  # Without the repository:tag name a loaded image would be unnamed, and the
  # runner's pull of the labelled reference could not match it.
  name=${ref%%@*}
  docker tag "$ref" "$name"
  names="$names $name"
done <"$list"

# shellcheck disable=SC2086 # names never contain whitespace (checked above)
docker save -o "$out/images.tar.tmp" $names
mv "$out/images.tar.tmp" "$out/images.tar"
echo "$want" >"$out/images.sha256.tmp"
mv "$out/images.sha256.tmp" "$out/images.sha256"
echo "initpad: CI image seed written ($(wc -c <"$out/images.tar") bytes)"
