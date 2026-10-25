#!/usr/bin/env bash
# Black-box evidence for the edge of the ADR-132 staging, run from the
# operator's machine, never from the staging host. It proves that the public
# origin answers only through the edge, that the origin server accepts no
# direct web traffic, that oversized bodies stop before the API and that the
# edge rate-limiting rule blocks a burst before it reaches the API.
set -euo pipefail

ORIGIN=${1:-}
SERVER_IP=${2:-}
BURST=${INITPAD_EDGE_BURST:-300}
# One request takes roughly 0.2 s through the edge, so a sequential burst stays
# below the rule's 100 requests per 10 seconds; parallel workers exceed it.
CONCURRENCY=${INITPAD_EDGE_CONCURRENCY:-10}
# Path matched by the edge rate-limiting rule (deploy/SAAS_STAGING.md).
RATE_PATH=${INITPAD_EDGE_RATE_PATH:-/api/health/live}

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
say()  { printf '\033[1;36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ $ORIGIN =~ ^https://[A-Za-z0-9.-]+$ && -n $SERVER_IP ]] || {
  echo 'Usage: ./edge-check.sh https://<public origin> <public IP of the staging server>' >&2
  exit 2
}
command -v curl >/dev/null || fail 'curl is required.'

# Succeeds when a TCP connection opens within five seconds. Plain bash, because
# macOS has no timeout(1) and a missing command must not read as a closed port.
port_open() {
  bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null &
  local probe=$! watchdog status=0
  (sleep 5 && kill "$probe" 2>/dev/null) &
  watchdog=$!
  { wait "$probe" || status=$?; } 2>/dev/null
  kill "$watchdog" 2>/dev/null || true
  { wait "$watchdog" || true; } 2>/dev/null
  return "$status"
}

say "Public origin $ORIGIN"
headers=$(curl -sS -D - -o /dev/null --max-time 10 "$ORIGIN/api/health/ready")
grep -qi '^cf-ray:' <<<"$headers" || fail 'The origin did not answer through the Cloudflare edge.'
grep -qi '^x-initpad-instance:' <<<"$headers" || fail 'The edge did not reach the API.'
pass 'Readiness answers through the edge and reaches the API'

say "Direct access to $SERVER_IP"
for port in 80 443 8080 3000 4318; do
  if port_open "$SERVER_IP" "$port"; then
    fail "Port $port of the origin server accepts connections; the edge can be bypassed."
  fi
  pass "Port $port of the origin server refuses connections"
done

say 'Request body limit'
# The bundled web proxy keeps the nginx default of 1 MiB for every API route.
status=$(head -c 2097152 /dev/zero | curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -X POST -H 'Content-Type: application/json' --data-binary @- "$ORIGIN/api/auth/login")
[[ $status == 413 ]] || fail "A 2 MiB body returned $status, expected 413."
pass 'A 2 MiB body is refused with 413 before the API'

say "Edge rate limit: $BURST requests to $RATE_PATH, $CONCURRENCY in parallel"
# The API's own limiter answers with X-InitPad-Instance; only a 429 without it
# comes from the edge rule.
edge_blocked=$(seq "$BURST" | xargs -n 1 -P "$CONCURRENCY" sh -c '
  response=$(curl -sS -D - -o /dev/null --max-time 10 "$0" || true)
  if printf "%s\n" "$response" | grep -q "^HTTP/[0-9.]* 429" &&
    ! printf "%s\n" "$response" | grep -qi "^x-initpad-instance:"; then
    echo edge
  fi
' "$ORIGIN$RATE_PATH" | grep -c edge || true)
((edge_blocked > 0)) || fail "No request was blocked by the edge; check the rate-limiting rule."
pass "The edge blocked $edge_blocked of $BURST requests without reaching the API"

pass 'Edge checks passed; record the output, it contains no credentials'
