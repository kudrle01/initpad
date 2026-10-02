#!/usr/bin/env bash
# Live acceptance for external SaaS PostgreSQL, S3 and recovery checkpoints.
set -euo pipefail
cd "$(dirname "$0")"

COMMAND=${1:-}
ENV_FILE=${2:-${INITPAD_SAAS_ENV_FILE:-.env.saas}}
ACCEPTANCE_DIR=.runtime/saas-acceptance
CHECKPOINT=$ACCEPTANCE_DIR/recovery.checkpoint
REPORT=$ACCEPTANCE_DIR/results.tsv
COMPOSE=(docker compose --env-file "$ENV_FILE" -f saas.compose.yml)

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
say()  { printf '\033[1;36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./saas-acceptance.sh <command> [env-file]

  dependencies   Verify public readiness, applied migrations and S3 round-trip
  email          Submit one staging message through the configured SMTP relay
  before-backup  Write the baseline markers before the external backup
  after-backup   Write markers which must disappear after external restore
  after-restore  Prove PostgreSQL and S3 returned to the same baseline

The three recovery commands require INITPAD_SAAS_ACCEPTANCE=1 and are intended
only for a disposable staging deployment. Run the provider's database and
bucket backup after before-backup, run after-backup, restore both external
services, start the control plane and finally run after-restore. Secret values
are read only inside the API probe container and are never printed or sourced.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is missing."
}

ensure_storage() {
  mkdir -p "$ACCEPTANCE_DIR"
  chmod 700 "$ACCEPTANCE_DIR"
  touch "$REPORT"
  chmod 600 "$REPORT"
}

record() {
  ensure_storage
  printf '%s\t%s\tPASS\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$REPORT"
}

checkpoint_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$CHECKPOINT"
}

valid_uuid() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
}

new_uuid() {
  [ -r /proc/sys/kernel/random/uuid ] || fail "Linux UUID source is unavailable."
  tr 'A-F' 'a-f' < /proc/sys/kernel/random/uuid | tr -d '\n'
}

write_checkpoint() {
  local baseline=$1 post_backup=${2:-} temporary
  temporary=$(mktemp "$ACCEPTANCE_DIR/recovery.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'baseline=%s\n' "$baseline"
    [ -z "$post_backup" ] || printf 'post_backup=%s\n' "$post_backup"
  } > "$temporary"
  mv "$temporary" "$CHECKPOINT"
}

ensure_runtime() {
  [ "$(uname -s)" = Linux ] || fail "SaaS live acceptance requires a Linux staging host."
  for command in docker curl awk mktemp; do require_command "$command"; done
  [ -r "$ENV_FILE" ] || fail "SaaS environment file '$ENV_FILE' is not readable."
  docker info >/dev/null 2>&1 || fail "Docker Engine is not running."
  ./saas-check.sh "$ENV_FILE" >/dev/null
  ensure_storage

  local service container health
  for service in api web; do
    container=$("${COMPOSE[@]}" ps -q "$service")
    [ -n "$container" ] || fail "SaaS service '$service' is not running."
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
    [ "$health" = healthy ] || fail "SaaS service '$service' is not healthy."
  done
}

public_readiness() {
  local api_container public_url
  api_container=$("${COMPOSE[@]}" ps -q api)
  public_url=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "$api_container" | awk -F= '$1 == "INITPAD_PLATFORM_PUBLIC_URL" { sub(/^[^=]*=/, ""); print; exit }')
  [[ "$public_url" =~ ^https:// ]] || fail "Rendered SaaS public URL is not HTTPS."
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
    --max-time 15 "$public_url/api/health/ready" | docker exec -i "$api_container" node -e '
      let source = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { source += chunk; });
      process.stdin.on("end", () => {
        const response = JSON.parse(source);
        if (
          response.status !== "ready" ||
          response.dependencies?.database !== "ok" ||
          response.dependencies?.artifactStore !== "ok"
        ) process.exit(1);
      });
    ' || fail "Public SaaS readiness did not confirm PostgreSQL and artifact storage."
}

probe() {
  "${COMPOSE[@]}" run --rm --no-deps api \
    node scripts/run-with-secrets.js node scripts/saas-dependency-probe.js "$@"
}

check_dependencies() {
  ensure_runtime
  public_readiness
  probe probe
  record saas-dependencies 'public_https=true migrations=true artifact_round_trip=true'
  pass "External PostgreSQL, private artifact storage and public readiness passed."
}

check_email() {
  ensure_runtime
  [ -n "${INITPAD_SMTP_ACCEPTANCE_RECIPIENT:-}" ] || \
    fail "Set INITPAD_SMTP_ACCEPTANCE_RECIPIENT to a staging inbox."
  "${COMPOSE[@]}" run --rm --no-deps \
    -e INITPAD_SMTP_ACCEPTANCE_RECIPIENT \
    api node scripts/run-with-secrets.js node scripts/saas-email-probe.js
  record saas-email 'smtp_authenticated=true message_submitted=true'
  pass "SMTP accepted the staging message. Confirm its arrival in the inbox."
}

require_recovery_opt_in() {
  [ "${INITPAD_SAAS_ACCEPTANCE:-0}" = 1 ] || \
    fail "Set INITPAD_SAAS_ACCEPTANCE=1 only on a disposable staging deployment."
}

before_backup() {
  require_recovery_opt_in
  ensure_runtime
  [ ! -e "$CHECKPOINT" ] || fail "A SaaS recovery checkpoint already exists."
  local baseline
  baseline=$(new_uuid)
  valid_uuid "$baseline" || fail "Could not generate a recovery marker."
  public_readiness
  probe baseline "$baseline"
  write_checkpoint "$baseline"
  record saas-before-backup 'baseline_markers=true'
  pass "Baseline markers exist in PostgreSQL and S3. Back up both external services now."
}

after_backup() {
  require_recovery_opt_in
  ensure_runtime
  [ -r "$CHECKPOINT" ] || fail "Run before-backup before creating post-backup markers."
  local baseline post_backup existing
  baseline=$(checkpoint_value baseline)
  existing=$(checkpoint_value post_backup)
  valid_uuid "$baseline" || fail "The baseline checkpoint is invalid."
  [ -z "$existing" ] || fail "Post-backup markers already exist; restore before continuing."
  post_backup=$(new_uuid)
  valid_uuid "$post_backup" || fail "Could not generate a post-backup marker."
  probe post-backup "$post_backup"
  write_checkpoint "$baseline" "$post_backup"
  record saas-after-backup 'post_backup_markers=true'
  pass "Post-backup markers exist. Restore PostgreSQL and S3 from the baseline backup."
}

after_restore() {
  require_recovery_opt_in
  ensure_runtime
  [ -r "$CHECKPOINT" ] || fail "No SaaS recovery checkpoint exists."
  local baseline post_backup
  baseline=$(checkpoint_value baseline)
  post_backup=$(checkpoint_value post_backup)
  valid_uuid "$baseline" || fail "The baseline checkpoint is invalid."
  valid_uuid "$post_backup" || fail "The post-backup checkpoint is invalid."
  public_readiness
  probe verify-restore "$baseline" "$post_backup"
  rm -f "$CHECKPOINT"
  record saas-after-restore 'database_restored=true artifact_store_restored=true consistent=true'
  pass "External PostgreSQL and S3 restored the same tested checkpoint."
}

case "$COMMAND" in
  dependencies) check_dependencies ;;
  email) check_email ;;
  before-backup) before_backup ;;
  after-backup) after_backup ;;
  after-restore) after_restore ;;
  -h|--help|'') usage ;;
  *) usage >&2; exit 1 ;;
esac
