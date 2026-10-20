#!/usr/bin/env bash
# Default-deny egress of the ADR-132 staging host. Containers may open new
# connections to the public internet only on the ports of their external
# dependencies; the host itself additionally reaches DNS, NTP, the tunnel and
# package mirrors. Private, link-local and metadata ranges are always refused.
# The rules filter by port, not by name: the dependencies sit behind CDNs whose
# addresses change, which ADR-132 records as a deviation.
set -euo pipefail

COMMAND=${1:-}
ENV_FILE=${2:-/secure/runtime/initpad-saas.env}
WAN_IF=${INITPAD_EGRESS_INTERFACE:-$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')}
# HTTPS (GitHub, R2, Infisical, Grafana Cloud), SMTP submission, Supabase poolers.
CONTAINER_TCP_PORTS=${INITPAD_EGRESS_CONTAINER_TCP_PORTS:-443,587,5432,6543}
# Package mirrors, registries and the cloudflared HTTP/2 fallback.
HOST_TCP_PORTS=${INITPAD_EGRESS_HOST_TCP_PORTS:-80,443,7844}
# Hetzner Cloud recursive resolvers; replace them on another provider.
DNS_V4=${INITPAD_EGRESS_DNS_V4:-185.12.64.1,185.12.64.2}
DNS_V6=${INITPAD_EGRESS_DNS_V6:-2a01:4ff:ff00::add:1,2a01:4ff:ff00::add:2}
BLOCKED_V4=0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,224.0.0.0/3
BLOCKED_V6=::1/128,fc00::/7,fe80::/10,ff00::/8
CONTAINERS=INITPAD-EGRESS-CONTAINERS
HOST=INITPAD-EGRESS-HOST
NETWORK=initpad-saas_control

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
say()  { printf '\033[1;36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./egress-firewall.sh <command> [env-file]

  apply   Install or replace the egress rules (idempotent)
  remove  Remove the rules and restore unrestricted egress
  status  Print the installed rules
  verify  Probe allowed and refused destinations from the host and from a
          container on the SaaS control network; prints only the evidence

Run as root on the staging host. Overrides: INITPAD_EGRESS_INTERFACE,
INITPAD_EGRESS_CONTAINER_TCP_PORTS, INITPAD_EGRESS_HOST_TCP_PORTS,
INITPAD_EGRESS_DNS_V4, INITPAD_EGRESS_DNS_V6.
EOF
}

require_root() {
  [[ $(id -u) -eq 0 ]] || fail 'Run as root.'
  [[ -n $WAN_IF ]] || fail 'Cannot detect the default route interface; set INITPAD_EGRESS_INTERFACE.'
}

# Replace a chain's content and make sure exactly one jump leads to it.
reset_chain() {
  local tool=$1 chain=$2 parent=$3
  "$tool" -N "$chain" 2>/dev/null || "$tool" -F "$chain"
  while "$tool" -D "$parent" -o "$WAN_IF" -j "$chain" 2>/dev/null; do :; done
  "$tool" -I "$parent" 1 -o "$WAN_IF" -j "$chain"
}

drop_chain() {
  local tool=$1 chain=$2 parent=$3
  while "$tool" -D "$parent" -o "$WAN_IF" -j "$chain" 2>/dev/null; do :; done
  "$tool" -F "$chain" 2>/dev/null || true
  "$tool" -X "$chain" 2>/dev/null || true
}

finish_chain() {
  local tool=$1 chain=$2
  "$tool" -A "$chain" -m limit --limit 6/min -j LOG --log-prefix "initpad-egress-drop "
  "$tool" -A "$chain" -j DROP
}

apply_family() {
  local tool=$1 blocked=$2 dns=$3
  # Containers: DOCKER-USER sees forwarded traffic before Docker accepts it.
  # RETURN hands an allowed connection back to Docker's own rules.
  if "$tool" -L DOCKER-USER -n >/dev/null 2>&1; then
    reset_chain "$tool" "$CONTAINERS" DOCKER-USER
    "$tool" -A "$CONTAINERS" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    # Docker's embedded resolver forwards from the container's namespace.
    "$tool" -A "$CONTAINERS" -p udp -d "$dns" --dport 53 -j RETURN
    "$tool" -A "$CONTAINERS" -p tcp -d "$dns" --dport 53 -j RETURN
    "$tool" -A "$CONTAINERS" -d "$blocked" -j DROP
    "$tool" -A "$CONTAINERS" -p tcp -m multiport --dports "$CONTAINER_TCP_PORTS" -j RETURN
    finish_chain "$tool" "$CONTAINERS"
  else
    say "$tool: Docker has no DOCKER-USER chain for this family, containers are not filtered"
  fi

  # Host processes, including cloudflared on the host network and the Docker
  # daemon, which also resolves names for the containers.
  reset_chain "$tool" "$HOST" OUTPUT
  "$tool" -A "$HOST" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  "$tool" -A "$HOST" -p udp -d "$dns" --dport 53 -j ACCEPT
  "$tool" -A "$HOST" -p tcp -d "$dns" --dport 53 -j ACCEPT
  "$tool" -A "$HOST" -d "$blocked" -j DROP
  "$tool" -A "$HOST" -p udp --dport 123 -j ACCEPT
  "$tool" -A "$HOST" -p udp --dport 7844 -j ACCEPT
  "$tool" -A "$HOST" -p tcp -m multiport --dports "$HOST_TCP_PORTS" -j ACCEPT
  finish_chain "$tool" "$HOST"
}

apply() {
  require_root
  apply_family iptables "$BLOCKED_V4" "$DNS_V4"
  apply_family ip6tables "$BLOCKED_V6" "$DNS_V6"
  pass "Default-deny egress applied on $WAN_IF"
}

remove() {
  require_root
  for tool in iptables ip6tables; do
    drop_chain "$tool" "$CONTAINERS" DOCKER-USER
    drop_chain "$tool" "$HOST" OUTPUT
  done
  pass "Egress rules removed from $WAN_IF"
}

status() {
  require_root
  for tool in iptables ip6tables; do
    for chain in "$CONTAINERS" "$HOST"; do
      "$tool" -S "$chain" 2>/dev/null || say "$tool: $chain is not installed"
    done
  done
}

# Prints "open" or "refused" for one TCP destination within three seconds.
host_probe() {
  if timeout 3 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; then echo open; else echo refused; fi
}

expect() {
  local where=$1 target=$2 wanted=$3 actual=$4
  [[ $actual == "$wanted" ]] || fail "$where $target is $actual, expected $wanted"
  pass "$where $target $actual"
}

verify() {
  require_root
  iptables -S "$HOST" >/dev/null 2>&1 || fail 'The rules are not installed; run apply first.'
  [[ -r $ENV_FILE ]] || fail "Cannot read $ENV_FILE."
  local image
  image=$(sed -n 's/^INITPAD_API_IMAGE=//p' "$ENV_FILE" | tail -n 1)
  [[ $image =~ @sha256:[a-f0-9]{64}$ ]] || fail 'INITPAD_API_IMAGE must be digest-pinned.'

  say "Host on $WAN_IF"
  expect host api.github.com:443 open "$(host_probe api.github.com 443)"
  expect host github.com:22 refused "$(host_probe github.com 22)"
  expect host 169.254.169.254:80 refused "$(host_probe 169.254.169.254 80)"

  say "Container on $NETWORK"
  # The API image is the process whose egress matters and already ships Node.
  local results
  results=$(docker run --rm --network "$NETWORK" --entrypoint node "$image" -e '
    const net = require("node:net");
    const probe = (host, port) => new Promise((resolve) => {
      const socket = net.connect({ host, port, timeout: 3000 });
      const done = (state) => { socket.destroy(); resolve(`${host}:${port} ${state}`); };
      socket.once("connect", () => done("open"));
      socket.once("timeout", () => done("refused"));
      socket.once("error", () => done("refused"));
    });
    Promise.all([
      probe("api.github.com", 443),
      probe("github.com", 22),
      probe("1.1.1.1", 53),
      probe("169.254.169.254", 80),
      probe("10.0.0.1", 443),
    ]).then((lines) => console.log(lines.join("\n")));
  ')
  while read -r target state; do
    case $target in
      api.github.com:443) expect container "$target" open "$state" ;;
      *) expect container "$target" refused "$state" ;;
    esac
  done <<<"$results"
  pass 'Egress policy verified; next run ./saas-acceptance.sh dependencies from deploy/'
}

case $COMMAND in
  apply) apply ;;
  remove) remove ;;
  status) status ;;
  verify) verify ;;
  *) usage; exit 2 ;;
esac
