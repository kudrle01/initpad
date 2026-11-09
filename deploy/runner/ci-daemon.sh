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

# With "tls internal" the registry certificate comes from InitPad's own CA.
# Trust it for the one configured registry host only (ADR-161); a rootless
# daemon reads per-registry CAs from its user configuration, which is a tmpfs
# rebuilt on every start.
ca=/opt/initpad-tls/initpad-root-ca.crt
if [ -s "$ca" ] && [ -n "${INITPAD_CI_REGISTRY_HOST:-}" ]; then
  certs=${XDG_CONFIG_HOME:-$HOME/.config}/docker/certs.d/$INITPAD_CI_REGISTRY_HOST
  mkdir -p "$certs"
  cp "$ca" "$certs/ca.crt"
fi

# The daemon's containerd image store fetches registry tokens with the system
# trust store and ignores certs.d, so `docker push` failed with "x509: certificate
# signed by unknown authority" although login and pull worked. This container
# is the isolated, throw-away CI daemon, so its own trust bundle may carry
# InitPad's CA; the host's trust store stays unchanged.
if [ -s "$ca" ] && [ -n "${INITPAD_CI_REGISTRY_HOST:-}" ]; then
  cat /etc/ssl/certs/ca-certificates.crt "$ca" > /tmp/initpad-ca-bundle.crt
  export SSL_CERT_FILE=/tmp/initpad-ca-bundle.crt
fi

dockerd-entrypoint.sh "$@" &
daemon=$!
trap 'kill -TERM "$daemon" 2>/dev/null || :; wait "$daemon" || :; exit 0' TERM INT

# The runner requests a reset by naming the daemon instance its job used. A
# request for an earlier instance is stale and ignored.
# The image seed (ADR-170) is a tar written by runner-seed and mounted read-only.
# Loading it from local disk replaces the job-image pull and unpack that would
# otherwise start every job. A failed load only costs the pull: the daemon is
# still clean, and the runner proceeds after its own timeout.
seed=/opt/initpad-seed/images.tar
load_seed() {
  [ -s "$seed" ] || return 0
  if docker load -q -i "$seed" >/dev/null; then
    echo 'initpad: CI image seed loaded'
  else
    echo 'initpad: CI image seed could not be loaded; jobs will pull their images'
  fi
}

current=
while kill -0 "$daemon" 2>/dev/null; do
  if [ -z "$current" ]; then
    current=$(docker info --format '{{.ID}}' 2>/dev/null) || current=
    [ -z "$current" ] || load_seed &
  elif [ -s "$request" ] && [ "$(cat "$request")" = "$current" ]; then
    # No graceful shutdown: the state is erased on the next start, and leaving
    # the container's init kills every process the job started.
    echo 'initpad: reset requested; restarting with an erased daemon'
    exit 0
  fi
  sleep 1
done
wait "$daemon"
