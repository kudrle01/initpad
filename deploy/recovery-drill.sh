#!/usr/bin/env bash
# Safe operational recovery exercises for a disposable self-hosted installation.
# Dependency outage modes are reversible. verify-restore is read-only and must
# be run immediately after restore.sh, before starting another deployment.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose --profile runner --profile server)

say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

get_env() {
  [ -f .env ] || return 0
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit}' .env
}

web_port=${INITPAD_WEB_PORT:-$(get_env INITPAD_WEB_PORT)}
web_port=${web_port:-8080}
readiness_url="http://127.0.0.1:${web_port}/api/health/ready"

database_scalar() {
  docker compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -Atqc "$1" -U initpad -d initpad
}

assert_no_active_work() {
  local count
  count=$(database_scalar '
    SELECT
      (SELECT count(*) FROM "DeploymentOperation" WHERE "status" = '\''running'\'') +
      (SELECT count(*) FROM "ProvisioningOperation" WHERE "status" IN ('\''running'\'', '\''cleaning'\'', '\''retrying'\'')) +
      (SELECT count(*) FROM "AgentJob" WHERE "status" IN ('\''blocked'\'', '\''queued'\'', '\''leased'\''));
  ')
  [ "$count" = 0 ] || fail "There are $count active operation(s); wait or cancel them before an outage drill."
}

http_status() {
  curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' "$readiness_url" || true
}

wait_http_status() {
  local expected=$1 attempts=${2:-30} status
  for _ in $(seq 1 "$attempts"); do
    status=$(http_status)
    [ "$status" = "$expected" ] && return 0
    sleep 1
  done
  fail "Readiness did not return HTTP $expected. Last response: $(tr '\n' ' ' < "$response_file")"
}

wait_healthy() {
  local service=$1 attempts=${2:-60} cid state
  for _ in $(seq 1 "$attempts"); do
    cid=$(docker compose ps -q "$service" 2>/dev/null || true)
    state=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)
    [ "$state" = healthy ] && return 0
    sleep 1
  done
  fail "$service did not become healthy."
}

artifact_store_outage() {
  assert_no_active_work
  response_file=$(mktemp "${TMPDIR:-/tmp}/initpad-readiness.XXXXXX")
  local outage_started=0
  recover_artifact_store() {
    local status=$?
    if [ "$outage_started" -eq 1 ]; then
      say "Restoring artifact storage"
      docker compose up -d minio >/dev/null
      wait_healthy minio 60
      docker compose run --rm minio-init >/dev/null
    fi
    rm -f "$response_file"
    return "$status"
  }
  trap recover_artifact_store EXIT

  wait_http_status 200 10
  grep -q '"artifactStore":"ok"' "$response_file" || \
    fail "Readiness does not report a healthy artifact store. Re-run ./install.sh first."

  say "Stopping MinIO for a controlled outage"
  outage_started=1
  docker compose stop minio >/dev/null
  wait_http_status 503 15
  grep -q '"artifactStore":"unavailable"' "$response_file" || \
    fail "API returned 503 but did not identify artifact storage as unavailable."

  say "Restoring MinIO and its private bucket policy"
  docker compose up -d minio >/dev/null
  wait_healthy minio 60
  docker compose run --rm minio-init >/dev/null
  wait_http_status 200 30
  grep -q '"artifactStore":"ok"' "$response_file" || \
    fail "Artifact store recovered but readiness did not confirm it."
  outage_started=0
  trap - EXIT
  rm -f "$response_file"
  printf '\033[1;32m✔\033[0m Artifact-store outage and recovery passed.\n'
}

registry_outage() {
  assert_no_active_work
  wait_healthy gitea 10
  local outage_started=0
  recover_registry() {
    local status=$?
    if [ "$outage_started" -eq 1 ]; then
      say "Restoring the SCM/OCI registry"
      docker compose up -d gitea >/dev/null
      wait_healthy gitea 60
    fi
    return "$status"
  }
  trap recover_registry EXIT

  say "Stopping Gitea SCM/OCI for a controlled outage"
  outage_started=1
  docker compose stop gitea >/dev/null
  [ -z "$(docker compose ps -q --status running gitea)" ] || \
    fail "Gitea is still running after the outage request."

  say "Restoring Gitea SCM/OCI"
  docker compose up -d gitea >/dev/null
  wait_healthy gitea 60
  outage_started=0
  trap - EXIT
  printf '\033[1;32m✔\033[0m SCM/OCI registry outage and recovery passed.\n'
}

assert_zero() {
  local label=$1 query=$2 count
  count=$(database_scalar "$query")
  [ "$count" = 0 ] || fail "$label: found $count stale row(s)."
  say "$label: OK"
}

verify_restore() {
  response_file=$(mktemp "${TMPDIR:-/tmp}/initpad-readiness.XXXXXX")
  trap 'rm -f "$response_file"' EXIT
  wait_http_status 200 10
  grep -q '"artifactStore":"ok"' "$response_file" || \
    fail "Restored API does not report healthy artifact storage."

  assert_zero "No active deployment operation survived" \
    'SELECT count(*) FROM "DeploymentOperation" WHERE "status" = '\''running'\'';'
  assert_zero "No target-authoritative Agent job survived" \
    'SELECT count(*) FROM "AgentJob" WHERE "status" IN ('\''blocked'\'', '\''queued'\'', '\''leased'\'');'
  assert_zero "No provisioning lease survived" \
    'SELECT count(*) FROM "ProvisioningOperation" WHERE "status" IN ('\''running'\'', '\''cleaning'\'', '\''retrying'\'') OR "leaseOwner" IS NOT NULL OR "leaseExpiresAt" IS NOT NULL;'
  assert_zero "No applying external effect survived" \
    'SELECT count(*) FROM "ProvisioningEffect" WHERE "status" = '\''applying'\'';'
  assert_zero "No stale environment is presented as current" \
    'SELECT count(*) FROM "Environment" WHERE "activeOperationId" IS NOT NULL OR (("version" IS NOT NULL OR "url" IS NOT NULL) AND ("status" <> '\''failed'\'' OR NOT "deploymentRequired"));'
  assert_zero "No gateway projection is presented as observed" \
    'SELECT count(*) FROM "GatewayRoute" WHERE "reconcileJobId" IS NOT NULL OR "observedRevision" IS NOT NULL OR "observedState" <> '\''failed'\'';'
  assert_zero "No workload diagnostic is presented as observed" \
    'SELECT count(*) FROM "WorkloadDiagnostic" WHERE "currentJobId" IS NOT NULL OR "runtimeState" IS NOT NULL OR "health" IS NOT NULL OR "observedAt" IS NOT NULL;'

  local managed
  managed=$(docker ps -aq --filter label=com.initpad.managed=true)
  [ -z "$managed" ] || fail "Managed local workloads survived restore; run restore.sh again."
  say "No managed local workload survived: OK"

  docker compose run --rm minio-init >/dev/null
  say "Private artifact bucket is reachable: OK"
  trap - EXIT
  rm -f "$response_file"
  printf '\033[1;32m✔\033[0m Restored control-plane invariants passed.\n'
}

case "${1:-}" in
  artifact-store-outage) artifact_store_outage ;;
  registry-outage) registry_outage ;;
  verify-restore) verify_restore ;;
  *)
    command cat <<'EOF'
Usage: ./recovery-drill.sh <command>

  artifact-store-outage  Stop MinIO, require API 503, restore it, require API 200
  registry-outage        Stop and health-check recovery of the bundled Gitea/OCI service
  verify-restore         Read-only invariant check immediately after restore.sh

Run only on a disposable acceptance VM. Outage modes refuse to start while
deployment, provisioning or Agent work is active.
EOF
    exit 1
    ;;
esac
