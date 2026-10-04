#!/usr/bin/env bash
# Live acceptance for external SaaS PostgreSQL, S3 and recovery checkpoints.
set -euo pipefail
cd "$(dirname "$0")"

COMMAND=${1:-}
ENV_FILE=${2:-${INITPAD_SAAS_ENV_FILE:-.env.saas}}
ACCEPTANCE_DIR=.runtime/saas-acceptance
CHECKPOINT=$ACCEPTANCE_DIR/recovery.checkpoint
SMTP_OUTAGE_CHECKPOINT=$ACCEPTANCE_DIR/smtp-outage.checkpoint
MUTATION_FAILOVER_CHECKPOINT=$ACCEPTANCE_DIR/mutation-failover.checkpoint
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
  load           Exercise the public edge through at least two API replicas
  load-failover  Exercise the public edge while restarting one API replica
  agent-failover-before  Queue one redeploy, then restart its accepting API replica
  agent-failover-after   Prove the restarted control plane completed that Agent job once
  agent-failover-cleanup Remove only a failed drill's temporary user fixture
  smtp-outage-before  Prove an SMTP outage queues a retry without failing the API
  smtp-outage-after   Prove the queued message is delivered after SMTP recovers
  smtp-outage-cleanup Remove a failed drill's isolated fixture
  before-backup  Write the baseline markers before the external backup
  after-backup   Write markers which must disappear after external restore
  after-restore  Prove PostgreSQL and S3 returned to the same baseline

Recovery, SMTP outage, load-failover and Agent failover commands require
INITPAD_SAAS_ACCEPTANCE=1 and are intended only for a disposable staging
deployment. Secret values are read only inside the API probe container and are
never printed or sourced.
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

file_value() {
  local file=$1 key=$2
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file"
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

write_mutation_checkpoint() {
  local marker=$1 operation=$2 instance=$3 project=$4 environment=$5 temporary
  temporary=$(mktemp "$ACCEPTANCE_DIR/mutation-failover.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'marker=%s\n' "$marker"
    printf 'operation=%s\n' "$operation"
    printf 'instance=%s\n' "$instance"
    printf 'project=%s\n' "$project"
    printf 'environment=%s\n' "$environment"
  } > "$temporary"
  mv "$temporary" "$MUTATION_FAILOVER_CHECKPOINT"
}

ensure_runtime() {
  [ "$(uname -s)" = Linux ] || fail "SaaS live acceptance requires a Linux staging host."
  for command in docker curl awk mktemp; do require_command "$command"; done
  [ -r "$ENV_FILE" ] || fail "SaaS environment file '$ENV_FILE' is not readable."
  docker info >/dev/null 2>&1 || fail "Docker Engine is not running."
  ./saas-check.sh "$ENV_FILE" >/dev/null
  ensure_storage

  local service containers container health
  for service in api web; do
    containers=$("${COMPOSE[@]}" ps -q "$service")
    [ -n "$containers" ] || fail "SaaS service '$service' is not running."
    while IFS= read -r container; do
      [ -n "$container" ] || continue
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
      [ "$health" = healthy ] || fail "SaaS service '$service' has an unhealthy replica."
    done <<< "$containers"
  done
}

public_readiness() {
  local api_container public_url
  api_container=$("${COMPOSE[@]}" ps -q api | head -n 1)
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

load_probe() {
  "${COMPOSE[@]}" run --rm --no-deps \
    -e INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 \
    -e INITPAD_LOAD_ACCEPTANCE_URL \
    -e INITPAD_LOAD_ACCEPTANCE_DURATION_SECONDS \
    -e INITPAD_LOAD_ACCEPTANCE_CONCURRENCY \
    -e INITPAD_LOAD_ACCEPTANCE_REQUEST_TIMEOUT_MS \
    -e INITPAD_LOAD_ACCEPTANCE_MIN_REQUESTS \
    -e INITPAD_LOAD_ACCEPTANCE_MIN_INSTANCES \
    -e INITPAD_LOAD_ACCEPTANCE_MAX_P95_MS \
    -e INITPAD_LOAD_ACCEPTANCE_MAX_ERROR_RATE \
    api node scripts/run-with-secrets.js node scripts/saas-load-probe.js
}

load_summary() {
  awk '/^LOAD_RESULT / { line = $0 } END { print line }'
}

require_api_replicas() {
  local replicas
  replicas=$("${COMPOSE[@]}" ps -q api | awk 'NF { count += 1 } END { print count + 0 }')
  [ "$replicas" -ge 2 ] || \
    fail "This acceptance command requires at least two healthy API replicas behind the public edge."
  printf '%s\n' "$replicas"
}

summary_field() {
  local key=$1
  awk -v key="$key" '{
    for (index = 1; index <= NF; index += 1) {
      if ($index ~ ("^" key "=")) {
        print substr($index, length(key) + 2)
        exit
      }
    }
  }'
}

api_container_for_instance() {
  local desired=$1 container observed selected= matches=0
  while IFS= read -r container; do
    [ -n "$container" ] || continue
    observed=$(docker exec "$container" node -e '
      fetch("http://127.0.0.1:3000/api/health/live", {
        signal: AbortSignal.timeout(5000),
      }).then((response) => {
        const instance = response.headers.get("x-initpad-instance");
        if (!instance) process.exit(1);
        process.stdout.write(instance);
      }).catch(() => process.exit(1));
    ' 2>/dev/null || true)
    if [ "$observed" = "$desired" ]; then
      selected=$container
      matches=$((matches + 1))
    fi
  done <<< "$("${COMPOSE[@]}" ps -q api)"
  [ "$matches" -eq 1 ] || return 1
  printf '%s\n' "$selected"
}

wait_container_healthy() {
  local container=$1 status attempt=0
  while [ "$attempt" -lt 60 ]; do
    status=$(docker inspect --format \
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$container" 2>/dev/null || true)
    [ "$status" = healthy ] && return 0
    case "$status" in unhealthy|exited|dead) return 1;; esac
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

check_load() {
  ensure_runtime
  public_readiness
  local replicas result summary
  replicas=$(require_api_replicas)
  result=$(load_probe)
  printf '%s\n' "$result"
  summary=$(printf '%s\n' "$result" | load_summary)
  [ -n "$summary" ] || fail "Load probe did not return a bounded result."
  record saas-load "${summary#LOAD_RESULT }"
  pass "Public edge load passed through $replicas healthy API replicas."
}

check_load_failover() {
  require_recovery_opt_in
  ensure_runtime
  public_readiness
  local replicas containers victim output probe_pid probe_status result summary ready attempt
  replicas=$(require_api_replicas)
  containers=$("${COMPOSE[@]}" ps -q api)
  victim=$(printf '%s\n' "$containers" | awk 'NF { print; exit }')
  [ -n "$victim" ] || fail "Could not select an API replica for failover."

  output=$(mktemp "$ACCEPTANCE_DIR/load-failover.XXXXXX")
  chmod 600 "$output"
  probe_pid=
  cleanup_load_failover() {
    if [ -n "$probe_pid" ] && kill -0 "$probe_pid" 2>/dev/null; then
      kill "$probe_pid" 2>/dev/null || true
      wait "$probe_pid" 2>/dev/null || true
    fi
    rm -f "$output"
  }
  trap cleanup_load_failover EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  load_probe > "$output" 2>&1 &
  probe_pid=$!
  ready=no
  attempt=0
  while [ "$attempt" -lt 120 ]; do
    if grep -qx 'LOAD_STARTED' "$output"; then
      ready=yes
      break
    fi
    kill -0 "$probe_pid" 2>/dev/null || break
    attempt=$((attempt + 1))
    sleep 0.5
  done
  if [ "$ready" != yes ]; then
    wait "$probe_pid" 2>/dev/null || true
    probe_pid=
    cat "$output"
    fail "Load probe did not reach its synchronized start marker."
  fi

  say "Restarting one API replica while the public load probe is active"
  docker restart --time 5 "$victim" >/dev/null || fail "Could not restart the selected API replica."
  wait_container_healthy "$victim" || fail "Restarted API replica did not become healthy."

  set +e
  wait "$probe_pid"
  probe_status=$?
  set -e
  probe_pid=
  result=$(cat "$output")
  printf '%s\n' "$result"
  [ "$probe_status" -eq 0 ] || fail "Public load probe failed during API replica restart."
  summary=$(printf '%s\n' "$result" | load_summary)
  [ -n "$summary" ] || fail "Load failover probe did not return a bounded result."
  public_readiness
  record saas-load-failover "${summary#LOAD_RESULT } replica_restart=true"

  trap - EXIT INT TERM
  rm -f "$output"
  pass "Public edge remained within its load thresholds while one of $replicas API replicas restarted."
}

agent_failover_probe() {
  local command=$1 marker=$2 project=$3 environment=$4 operation=${5:-}
  local arguments=("$command" "$marker")
  [ -z "$operation" ] || arguments+=("$operation")
  "${COMPOSE[@]}" run --rm --no-deps \
    -e INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 \
    -e INITPAD_MUTATION_ACCEPTANCE_URL \
    -e INITPAD_MUTATION_ACCEPTANCE_TIMEOUT_SECONDS \
    -e INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID="$project" \
    -e INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT="$environment" \
    api node scripts/run-with-secrets.js node scripts/saas-agent-failover-probe.js \
    "${arguments[@]}"
}

agent_failover_before() {
  require_recovery_opt_in
  ensure_runtime
  public_readiness
  [ ! -e "$MUTATION_FAILOVER_CHECKPOINT" ] || \
    fail "An Agent failover checkpoint already exists."
  local replicas project environment marker result summary operation instance victim
  replicas=$(require_api_replicas)
  project=${INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID:-}
  environment=${INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT:-dev}
  valid_uuid "$project" || \
    fail "Set INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID to a disposable project UUID."
  case "$environment" in dev|test) ;; *) fail "Agent failover environment must be dev or test.";; esac
  marker=$(new_uuid)
  result=$(agent_failover_probe before "$marker" "$project" "$environment")
  printf '%s\n' "$result"
  summary=$(printf '%s\n' "$result" | awk '/^MUTATION_FAILOVER_PREPARED / { line = $0 } END { print line }')
  [ -n "$summary" ] || fail "Agent failover probe did not return its bounded checkpoint."
  operation=$(printf '%s\n' "$summary" | summary_field operation)
  instance=$(printf '%s\n' "$summary" | summary_field instance)
  valid_uuid "$operation" || fail "Agent failover probe returned an invalid operation."
  valid_uuid "$instance" || fail "Agent failover probe returned an invalid API instance."
  write_mutation_checkpoint "$marker" "$operation" "$instance" "$project" "$environment"
  victim=$(api_container_for_instance "$instance") || \
    fail "The accepting API instance does not map to exactly one local Compose replica."

  say "Restarting the API replica which accepted the durable Agent redeploy"
  docker restart --time 5 "$victim" >/dev/null || fail "Could not restart the accepting API replica."
  wait_container_healthy "$victim" || fail "Restarted API replica did not become healthy."
  public_readiness
  record saas-agent-failover-before \
    "replicas=$replicas durable_job_queued=true accepting_replica_restarted=true"
  pass "The accepting API replica restarted. Start the disposable target Agent, then run agent-failover-after."
}

agent_failover_after() {
  require_recovery_opt_in
  ensure_runtime
  public_readiness
  [ -r "$MUTATION_FAILOVER_CHECKPOINT" ] || fail "No Agent failover checkpoint exists."
  local marker operation project environment result summary
  marker=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" marker)
  operation=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" operation)
  project=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" project)
  environment=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" environment)
  valid_uuid "$marker" || fail "The Agent failover marker is invalid."
  valid_uuid "$operation" || fail "The Agent failover operation is invalid."
  valid_uuid "$project" || fail "The Agent failover project is invalid."
  case "$environment" in dev|test) ;; *) fail "The Agent failover environment is invalid.";; esac
  result=$(agent_failover_probe after "$marker" "$project" "$environment" "$operation")
  printf '%s\n' "$result"
  summary=$(printf '%s\n' "$result" | awk '/^MUTATION_FAILOVER_RECOVERED / { line = $0 } END { print line }')
  [ -n "$summary" ] || fail "Agent failover recovery did not return bounded evidence."
  public_readiness
  rm -f "$MUTATION_FAILOVER_CHECKPOINT"
  record saas-agent-failover-after "${summary#MUTATION_FAILOVER_RECOVERED } api_ready=true"
  pass "The durable Agent redeploy completed exactly once after its accepting API replica restarted."
}

agent_failover_cleanup() {
  require_recovery_opt_in
  ensure_runtime
  [ -r "$MUTATION_FAILOVER_CHECKPOINT" ] || fail "No Agent failover checkpoint exists."
  local marker project environment
  marker=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" marker)
  project=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" project)
  environment=$(file_value "$MUTATION_FAILOVER_CHECKPOINT" environment)
  valid_uuid "$marker" || fail "The Agent failover marker is invalid."
  valid_uuid "$project" || fail "The Agent failover project is invalid."
  case "$environment" in dev|test) ;; *) fail "The Agent failover environment is invalid.";; esac
  agent_failover_probe cleanup "$marker" "$project" "$environment"
  rm -f "$MUTATION_FAILOVER_CHECKPOINT"
  pass "The temporary Agent failover user was removed; inspect the disposable project operation separately."
}

smtp_outage_probe() {
  local command=$1 marker=$2
  "${COMPOSE[@]}" run --rm --no-deps \
    -e INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 \
    -e INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT \
    api node scripts/run-with-secrets.js node scripts/saas-smtp-outage-probe.js \
    "$command" "$marker"
}

smtp_outage_before() {
  require_recovery_opt_in
  ensure_runtime
  [ ! -e "$SMTP_OUTAGE_CHECKPOINT" ] || fail "An SMTP outage checkpoint already exists."
  [ -n "${INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT:-}" ] || \
    fail "Set INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT to an unused staging inbox."
  local marker temporary
  marker=$(new_uuid)
  smtp_outage_probe prepare "$marker"
  temporary=$(mktemp "$ACCEPTANCE_DIR/smtp-outage.XXXXXX")
  chmod 600 "$temporary"
  printf 'marker=%s\n' "$marker" > "$temporary"
  mv "$temporary" "$SMTP_OUTAGE_CHECKPOINT"
  record saas-smtp-outage-before 'api_ready=true retry_persisted=true'
  pass "SMTP outage preserved a retryable message. Restore SMTP egress now."
}

smtp_outage_after() {
  require_recovery_opt_in
  ensure_runtime
  [ -r "$SMTP_OUTAGE_CHECKPOINT" ] || fail "No SMTP outage checkpoint exists."
  local marker
  marker=$(awk -F= '$1 == "marker" { print $2; exit }' "$SMTP_OUTAGE_CHECKPOINT")
  valid_uuid "$marker" || fail "The SMTP outage checkpoint is invalid."
  smtp_outage_probe recover "$marker"
  rm -f "$SMTP_OUTAGE_CHECKPOINT"
  record saas-smtp-outage-after 'delivered=true payload_erased=true retry_observed=true'
  pass "SMTP recovery delivered the queued message and erased its secret payload."
}

smtp_outage_cleanup() {
  require_recovery_opt_in
  ensure_runtime
  [ -r "$SMTP_OUTAGE_CHECKPOINT" ] || fail "No SMTP outage checkpoint exists."
  local marker
  marker=$(awk -F= '$1 == "marker" { print $2; exit }' "$SMTP_OUTAGE_CHECKPOINT")
  valid_uuid "$marker" || fail "The SMTP outage checkpoint is invalid."
  smtp_outage_probe cleanup "$marker"
  rm -f "$SMTP_OUTAGE_CHECKPOINT"
  pass "SMTP outage fixture and checkpoint were removed."
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
  load) check_load ;;
  load-failover) check_load_failover ;;
  agent-failover-before) agent_failover_before ;;
  agent-failover-after) agent_failover_after ;;
  agent-failover-cleanup) agent_failover_cleanup ;;
  smtp-outage-before) smtp_outage_before ;;
  smtp-outage-after) smtp_outage_after ;;
  smtp-outage-cleanup) smtp_outage_cleanup ;;
  before-backup) before_backup ;;
  after-backup) after_backup ;;
  after-restore) after_restore ;;
  -h|--help|'') usage ;;
  *) usage >&2; exit 1 ;;
esac
