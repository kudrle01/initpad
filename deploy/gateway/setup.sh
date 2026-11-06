#!/bin/sh
# Starts the InitPad managed gateway reference deployment (ADR-164):
# private CA, TLS edge and inner gateway. Safe to run again.
set -eu

cd "$(dirname "$0")"
ADMIN_DIR=/var/lib/initpad-gateway-admin
WITH_CA=true

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [--no-ca]

Reads .env (copy .env.example first), creates the CA password once, starts the
private CA, exports its root certificate to ./ca-root.crt and then starts the
edge and the inner gateway.

  --no-ca   Use a CA that already exists elsewhere. Put its ACME directory in
            GATEWAY_CA_URL and its PEM root certificate in ./ca-root.crt first.
USAGE
}

fail() {
  printf 'setup.sh: %s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  '') ;;
  --no-ca) WITH_CA=false ;;
  -h | --help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || fail 'Docker Engine is required'
docker compose version >/dev/null 2>&1 || fail 'the Docker Compose plugin is required'
[ -f .env ] || fail 'create .env from .env.example first'

domain=$(sed -n 's/^GATEWAY_DOMAIN=//p' .env | tail -n 1)
printf '%s\n' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
  || fail 'GATEWAY_DOMAIN in .env must be a lower-case DNS name such as apps.example.lan'

case "$domain" in
  *.local)
    printf 'setup.sh: warning: %s ends in .local, which is reserved for mDNS. Many Linux resolvers do not send it to your DNS server, so lookups can fail. Prefer .lan, home.arpa or a subdomain you own.\n' "$domain" >&2
    ;;
esac

if [ ! -d "$ADMIN_DIR" ]; then
  mkdir -p "$ADMIN_DIR" 2>/dev/null \
    || fail "cannot create $ADMIN_DIR; run this script as root (the Agent reaches the gateway through a socket there)"
  chmod 0700 "$ADMIN_DIR"
fi

if [ "$WITH_CA" = true ]; then
  if [ ! -s secrets/ca_password ]; then
    (umask 077 && mkdir -p secrets && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > secrets/ca_password)
    printf 'Created the CA password in secrets/ca_password. Back it up; the CA cannot be restored without it.\n'
  fi
  docker compose --profile ca up -d ca
  printf 'Waiting for the CA...\n'
  i=0
  until [ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose --profile ca ps -q ca)" 2>/dev/null)" = healthy ]; do
    i=$((i + 1))
    [ "$i" -le 60 ] || fail 'the CA did not become healthy; see: docker compose --profile ca logs ca'
    sleep 2
  done
  docker compose --profile ca cp ca:/home/step/certs/root_ca.crt ./ca-root.crt
  chmod 0644 ca-root.crt
fi

[ -s ca-root.crt ] || fail 'ca-root.crt is missing'

docker compose up -d gateway edge

printf '\nGateway started for %s.\n' "$domain"
printf 'CA root certificate: %s/ca-root.crt\n' "$(pwd)"
if command -v openssl >/dev/null 2>&1; then
  openssl x509 -in ca-root.crt -noout -subject -fingerprint -sha256
fi
cat <<'NEXT'

Next:
  1. Check the fingerprint above on every machine you copy ca-root.crt to.
  2. Install ca-root.crt on the computers whose browsers open the applications.
  3. Install InitPad Agent with:
       --gateway-container initpad-gateway \
       --gateway-admin-socket /var/lib/initpad-gateway-admin/admin.sock \
       --ca-file <path to a PEM that contains ca-root.crt>
  4. In Manage Agent choose "Test gateway".
NEXT
