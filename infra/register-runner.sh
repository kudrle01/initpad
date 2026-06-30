#!/usr/bin/env bash
# Vygeneruje registrační token pro Gitea Actions runner.
# Token je potřeba jen jednou – po registraci si ho runner uloží do volume
# runner-data. Gitea musí běžet a mít dokončený první setup (admin účet).
#
#   docker compose -f infra/docker-compose.yml up -d gitea postgres
#   ./infra/register-runner.sh
#
# Záměrně bez `set -e`, ať se při chybě vypíše reálný výstup z Gitey.
set -uo pipefail

COMPOSE="docker compose -f $(dirname "$0")/docker-compose.yml"

# gitea CLI samo nenajde app.ini, když se spustí mimo entrypoint – najdeme ho.
echo "› Hledám app.ini v kontejneru…" >&2
CONF=$($COMPOSE exec -T gitea sh -c \
  'test -f /data/gitea/conf/app.ini && echo /data/gitea/conf/app.ini || find /data /etc/gitea -name app.ini 2>/dev/null | head -1' \
  | tr -d '\r\n')

if [ -z "$CONF" ]; then
  echo "✗ Nenašel jsem app.ini – Gitea zřejmě není nainstalovaná." >&2
  echo "  Otevři http://localhost:3001 a dokonči první setup (vytvoř admin účet)." >&2
  exit 1
fi
echo "› Konfigurace: $CONF" >&2

WORKDIR=$(dirname "$(dirname "$CONF")")   # /data/gitea/conf/app.ini -> /data/gitea

echo "› Generuji registrační token z Gitey…" >&2
# gitea CLI musí běžet pod uživatelem 'git' (jinak odmítne běh jako root)
# a potřebuje --work-path (v Docker image ho jinak nastaví až entrypoint).
OUT=$($COMPOSE exec -T -u git gitea \
  gitea --work-path "$WORKDIR" --config "$CONF" actions generate-runner-token 2>&1)
STATUS=$?

# Token = poslední řádek tvořený jen alfanumerickými znaky (ignoruje warningy).
TOKEN=$(printf '%s\n' "$OUT" | grep -E '^[A-Za-z0-9]{30,}$' | tail -1 || true)

if [ "$STATUS" -ne 0 ] || [ -z "$TOKEN" ]; then
  echo "✗ Token se nepodařilo získat. Výstup z Gitey:" >&2
  echo "----------------------------------------" >&2
  echo "$OUT" >&2
  echo "----------------------------------------" >&2
  echo "Tip: běží Gitea a je dokončený první setup (vytvořený admin účet)?" >&2
  exit 1
fi

cat >&2 <<EOF
✓ Token vygenerován. Spusť runner tímto příkazem:

  INITPAD_RUNNER_TOKEN=$TOKEN \\
    docker compose -f infra/docker-compose.yml --profile ci up -d act_runner

EOF
echo "$TOKEN"
