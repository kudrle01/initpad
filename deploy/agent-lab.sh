#!/bin/sh
set -eu

cd "$(dirname "$0")"

compose() {
  docker compose \
    -f docker-compose.yml \
    -f agent-lab.compose.yml \
    --profile agent-lab \
    "$@"
}

public_port="${INITPAD_WEB_PORT:-8080}"
control_plane_url="${INITPAD_AGENT_LAB_URL:-http://host.docker.internal:${public_port}}"

case "${1:-help}" in
  build)
    compose build agent-lab
    ;;
  enroll)
    compose run --rm -it agent-lab \
      enroll --url "$control_plane_url" --allow-insecure-http
    ;;
  start)
    compose up -d agent-lab-docker agent-lab-ports agent-lab
    ;;
  once)
    compose run --rm agent-lab once
    ;;
  status)
    compose ps agent-lab agent-lab-docker agent-lab-ports
    ;;
  logs)
    compose logs --tail=100 -f agent-lab
    ;;
  docker)
    shift
    compose exec -T agent-lab-docker docker "$@"
    ;;
  stop)
    compose stop agent-lab agent-lab-ports agent-lab-docker
    ;;
  *)
    cat <<'USAGE'
Usage: ./agent-lab.sh <command>

  build   Build the local InitPad Agent image
  enroll  Prompt for a one-time token and store the resulting credential
  start   Start the Agent and its isolated Docker daemon
  once    Send one heartbeat and exit
  status  Show the two lab containers
  logs    Follow structured Agent logs
  docker  Run a Docker CLI inspection inside the isolated target daemon
  stop    Stop only the Agent lab (the InitPad platform keeps running)

Create a Docker (InitPad Agent) target in Infrastructure and generate its
one-time enrollment before running `./agent-lab.sh enroll`.
For local browser links, set the target public URL to http://127.0.0.1. The
lab publishes only its dedicated workload range on host loopback; it never
publishes the nested Docker API.
USAGE
    ;;
esac
