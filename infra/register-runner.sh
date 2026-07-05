#!/usr/bin/env bash
# Generates a registration token for the Gitea Actions runner.
# The token is needed only once — after registering, the runner keeps its
# state in the runner-data volume. Gitea must be running with the initial
# setup finished (admin account created).
#
#   docker compose -f infra/docker-compose.yml up -d gitea postgres
#   ./infra/register-runner.sh
#
# Deliberately no `set -e`, so a failure prints the actual Gitea output.
set -uo pipefail

COMPOSE="docker compose -f $(dirname "$0")/docker-compose.yml"

# The gitea CLI cannot find app.ini on its own when run outside the
# entrypoint — locate it first.
echo "› Looking for app.ini in the container…" >&2
CONF=$($COMPOSE exec -T gitea sh -c \
  'test -f /data/gitea/conf/app.ini && echo /data/gitea/conf/app.ini || find /data /etc/gitea -name app.ini 2>/dev/null | head -1' \
  | tr -d '\r\n')

if [ -z "$CONF" ]; then
  echo "✗ app.ini not found — Gitea is probably not installed yet." >&2
  echo "  Open http://localhost:3001 and finish the initial setup (create the admin account)." >&2
  exit 1
fi
echo "› Config: $CONF" >&2

WORKDIR=$(dirname "$(dirname "$CONF")")   # /data/gitea/conf/app.ini -> /data/gitea

echo "› Generating the registration token…" >&2
# The gitea CLI must run as the 'git' user (it refuses to run as root) and
# needs --work-path (normally set by the container entrypoint).
OUT=$($COMPOSE exec -T -u git gitea \
  gitea --work-path "$WORKDIR" --config "$CONF" actions generate-runner-token 2>&1)
STATUS=$?

# Token = the last line consisting purely of alphanumerics (skips warnings).
TOKEN=$(printf '%s\n' "$OUT" | grep -E '^[A-Za-z0-9]{30,}$' | tail -1 || true)

if [ "$STATUS" -ne 0 ] || [ -z "$TOKEN" ]; then
  echo "✗ Could not obtain the token. Gitea output:" >&2
  echo "----------------------------------------" >&2
  echo "$OUT" >&2
  echo "----------------------------------------" >&2
  echo "Hint: is Gitea running with the initial setup finished (admin account created)?" >&2
  exit 1
fi

cat >&2 <<MSG
✓ Token generated. Start the runner with:

  INITPAD_RUNNER_TOKEN=$TOKEN \\
    docker compose -f infra/docker-compose.yml --profile ci up -d act_runner

MSG
echo "$TOKEN"
