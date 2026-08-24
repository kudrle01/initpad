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
gateway_domain="${INITPAD_AGENT_LAB_GATEWAY_DOMAIN:-apps.initpad.test}"
gateway_dns_port="${INITPAD_AGENT_LAB_DNS_PORT:-5533}"
gateway_runtime_dir=".runtime/agent-lab"
gateway_ca="$gateway_runtime_dir/root.crt"

case "${1:-help}" in
  build)
    # The secondary service inherits this exact image tag, so one build keeps
    # every lab identity on the same Agent protocol version.
    compose build agent-lab
    ;;
  gateway-setup)
    # Do not race Caddy's asynchronous internal-CA bootstrap. The certificate
    # is part of the edge health contract and must exist before it is copied.
    compose up -d --wait --wait-timeout 60 agent-lab-dns agent-lab-host-dns agent-lab-edge
    mkdir -p "$gateway_runtime_dir"
    compose cp agent-lab-edge:/data/caddy/pki/authorities/local/root.crt "$gateway_ca"
    chmod 0644 "$gateway_ca"
    cat <<EOF
Local managed-gateway DNS/TLS is ready for *.$gateway_domain.

To let macOS resolve the local wildcard zone:
  sudo mkdir -p /etc/resolver
  printf 'domain $gateway_domain\\nnameserver 127.0.0.1\\nport $gateway_dns_port\\n' | sudo tee /etc/resolver/$gateway_domain >/dev/null
  sudo dscacheutil -flushcache

To trust the local Caddy CA in browsers on this Mac:
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain '$PWD/$gateway_ca'

These commands affect only the reserved $gateway_domain test zone and this
generated local CA. Re-run Test gateway after installing both settings.
EOF
    ;;
  enroll)
    compose run --rm -it agent-lab \
      enroll --url "$control_plane_url" --allow-insecure-http
    ;;
  enroll-secondary)
    compose run --rm -it agent-lab-secondary \
      enroll --url "$control_plane_url" --allow-insecure-http
    ;;
  start)
    compose up -d agent-lab-docker agent-lab-ports agent-lab
    ;;
  start-secondary)
    compose up -d agent-lab-docker agent-lab-ports agent-lab-secondary
    ;;
  once)
    compose run --rm agent-lab once
    ;;
  status)
    compose ps --all agent-lab agent-lab-secondary agent-lab-docker agent-lab-gateway-bootstrap agent-lab-dns agent-lab-host-dns agent-lab-edge agent-lab-ports
    ;;
  logs)
    compose logs --tail=100 -f agent-lab
    ;;
  logs-secondary)
    compose logs --tail=100 -f agent-lab-secondary
    ;;
  docker)
    shift
    compose exec -T agent-lab-docker docker "$@"
    ;;
  stop)
    compose stop agent-lab agent-lab-secondary agent-lab-ports agent-lab-edge agent-lab-host-dns agent-lab-dns agent-lab-docker
    ;;
  stop-secondary)
    compose stop agent-lab-secondary
    ;;
  *)
    cat <<'USAGE'
Usage: ./agent-lab.sh <command>

  build   Build the local InitPad Agent image
  gateway-setup  Start local wildcard DNS/TLS and print one-time macOS trust commands
  enroll  Prompt for a one-time token and store the resulting credential
  start   Start the Agent and its isolated Docker daemon
  enroll-secondary  Enroll a separate second target identity
  start-secondary   Start the second identity against the same Docker daemon
  logs-secondary    Follow structured logs for the second identity
  stop-secondary    Stop only the second identity
  once    Send one heartbeat and exit
  status  Show the lab daemon, gateway bootstrap, port bridge and Agent identities
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
