#!/bin/bash
# Entry point of act_runner (ADR-138). The runner takes one CI job at a time and
# starts it only on a Docker daemon that runner-docker erased before starting.
# After every job it asks runner-docker to restart, which erases the daemon
# again, so no job inherits containers, volumes, images or build cache from
# another one.
set -euo pipefail

daemon=http://runner-docker:2375
request_dir=/run/initpad-ci-reset

# The engine ID changes on every start because the erase removes the file that
# stores it. A job cannot choose it, so a new ID proves the daemon was erased.
# It is the first field of /info; reading only that field keeps a job's swarm
# or plugin state from posing as a different engine.
daemon_id() {
  local id
  id=$(wget -qO- -T 5 "$daemon/info" 2>/dev/null |
    sed -n 's/^{"ID":"\([0-9A-Za-z:-]*\)".*/\1/p') || return 1
  [[ -n $id ]] && printf '%s\n' "$id"
}

current_daemon() {
  local id
  until id=$(daemon_id); do sleep 1; done
  printf '%s\n' "$id"
}

request_reset() {
  printf '%s\n' "$1" > "$request_dir/request.tmp"
  mv "$request_dir/request.tmp" "$request_dir/request"
}

fresh_daemon_after() {
  local used=$1 id
  while :; do
    if id=$(daemon_id) && [[ $id != "$used" ]]; then
      printf '%s\n' "$id"
      return
    fi
    sleep 1
  done
}

stopping=0
runner=
trap 'stopping=1; [[ -z $runner ]] || kill -TERM "$runner" 2>/dev/null || :' TERM INT

# A job may have been running when this container stopped. Never reuse the
# daemon it left behind.
used=$(current_daemon)
request_reset "$used"

export GITEA_RUNNER_ONCE=1
while ((stopping == 0)); do
  fresh_daemon_after "$used" >/dev/null
  started=$SECONDS
  /usr/local/bin/run.sh &
  runner=$!
  status=0
  while kill -0 "$runner" 2>/dev/null; do wait "$runner" || status=$?; done
  runner=
  # The registration exists now; the token is not needed again.
  [[ ! -s /data/.runner ]] || unset GITEA_RUNNER_REGISTRATION_TOKEN
  # The next start of this script resets the daemon before taking a job.
  ((stopping == 0)) || break
  # Every daemon start erases first, so only the instance running now can hold
  # what the job left behind.
  used=$(current_daemon)
  request_reset "$used"
  # Do not spin when the runner cannot start, for example while Gitea is down.
  if ((status != 0 && SECONDS - started < 10 && stopping == 0)); then sleep 10; fi
done
