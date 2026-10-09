#!/bin/sh
# Entry point of runner-docker (ADR-138). Every start erases the complete state
# of the rootless Docker daemon before it runs, and the runner restarts this
# container after each CI job. Nothing a job leaves behind — containers,
# volumes, images, build cache or daemon files — can reach the next job.
set -eu

data=$HOME/.local/share/docker
request=/run/initpad-ci-reset/request

# Job containers run as subordinate UIDs of the rootless user namespace, so
# their files are only removable from inside that namespace. Refuse to start a
# daemon when anything from the previous job could not be deleted.
if [ -d "$data" ] && [ -n "$(ls -A "$data")" ]; then
  rootlesskit --net=host --disable-host-loopback=false \
    find "$data" -mindepth 1 -delete
  if [ -n "$(ls -A "$data")" ]; then
    echo >&2 'initpad: previous CI daemon state could not be erased; refusing to start'
    exit 1
  fi
fi

dockerd-entrypoint.sh "$@" &
daemon=$!
trap 'kill -TERM "$daemon" 2>/dev/null || :; wait "$daemon" || :; exit 0' TERM INT

# The runner requests a reset by naming the daemon instance its job used. A
# request for an earlier instance is stale and ignored.
current=
while kill -0 "$daemon" 2>/dev/null; do
  if [ -z "$current" ]; then
    current=$(docker info --format '{{.ID}}' 2>/dev/null) || current=
  elif [ -s "$request" ] && [ "$(cat "$request")" = "$current" ]; then
    # No graceful shutdown: the state is erased on the next start, and leaving
    # the container's init kills every process the job started.
    echo 'initpad: reset requested; restarting with an erased daemon'
    exit 0
  fi
  sleep 1
done
wait "$daemon"
