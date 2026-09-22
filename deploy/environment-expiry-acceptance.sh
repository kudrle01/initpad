#!/usr/bin/env bash
# Deterministic live acceptance for the dev/test environment TTL policy.
set -euo pipefail
cd "$(dirname "$0")"

ACCEPTANCE_DIR=.runtime/acceptance
CHECKPOINT=$ACCEPTANCE_DIR/environment-expiry.checkpoint
REPORT=$ACCEPTANCE_DIR/results.tsv

pass() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./environment-expiry-acceptance.sh <command> [arguments]

  arm <workspace-slug> <project-name> <dev|test>
      On a disposable acceptance installation, move one already TTL-managed
      environment into the past. Requires INITPAD_ACCEPTANCE_ALLOW_EXPIRY=1.

  verify
      Verify that the periodic lifecycle sweep removed the workload, wrote the
      bounded audit event and left the production environment unchanged.

The helper refuses production, active operations, workloads without a configured
TTL and a second outstanding checkpoint. It never reads configuration values,
secrets or credentials. Run it only on a disposable acceptance installation.
EOF
}

database_scalar() {
  docker compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -Atq -U initpad -d initpad -c "$1"
}

validate_identity() {
  local label=$1 value=$2
  [[ "$value" =~ ^[a-z0-9][a-z0-9._-]{0,62}$ ]] || \
    fail "$label must contain only lowercase letters, digits, dots, underscores or hyphens."
}

ensure_runtime() {
  [ -f .env ] || fail "deploy/.env is missing."
  docker compose ps -q postgres 2>/dev/null | grep -q . || \
    fail "The InitPad PostgreSQL service is not running."
}

ensure_report() {
  mkdir -p "$ACCEPTANCE_DIR"
  chmod 700 "$ACCEPTANCE_DIR"
  touch "$REPORT"
  chmod 600 "$REPORT"
}

record() {
  ensure_report
  printf '%s\t%s\tPASS\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$REPORT"
}

checkpoint_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$CHECKPOINT"
}

production_fingerprint_sql() {
  cat <<'SQL'
md5(concat_ws('|',
  COALESCE(prod."id", ''),
  COALESCE(prod."status", ''),
  COALESCE(prod."version", ''),
  COALESCE(prod."buildArtifactId", ''),
  COALESCE(prod."url", ''),
  COALESCE(prod."configRevision"::text, ''),
  COALESCE(prod."targetId", ''),
  COALESCE(prod."allocationId", ''),
  COALESCE(prod."activeOperationId", ''),
  COALESCE(prod."expiresAt"::text, ''),
  COALESCE(prod."expiryWarningAt"::text, '')
))
SQL
}

arm_expiry() {
  local workspace=${1:-} project=${2:-} environment=${3:-}
  validate_identity "Workspace slug" "$workspace"
  validate_identity "Project name" "$project"
  case "$environment" in
    dev|test) ;;
    prod) fail "Production can never be used for TTL acceptance." ;;
    *) fail "Environment must be dev or test." ;;
  esac
  [ "${INITPAD_ACCEPTANCE_ALLOW_EXPIRY:-0}" = 1 ] || \
    fail "Set INITPAD_ACCEPTANCE_ALLOW_EXPIRY=1 explicitly on a disposable installation."
  [ ! -e "$CHECKPOINT" ] || \
    fail "An environment expiry checkpoint already exists; verify it before arming another."
  ensure_runtime

  local fingerprint_sql candidate environment_id project_id production_fingerprint updated temporary
  fingerprint_sql=$(production_fingerprint_sql)
  candidate=$(database_scalar "
    SELECT concat_ws('|', e.\"id\", p.\"id\", $fingerprint_sql)
    FROM \"Environment\" e
    JOIN \"Project\" p ON p.\"id\" = e.\"projectId\"
    JOIN \"Workspace\" w ON w.\"id\" = p.\"workspaceId\"
    JOIN \"TargetAllocation\" a ON a.\"id\" = e.\"allocationId\"
    LEFT JOIN \"Environment\" prod
      ON prod.\"projectId\" = p.\"id\" AND prod.\"name\" = 'prod'
    WHERE w.\"slug\" = '$workspace'
      AND p.\"name\" = '$project'
      AND e.\"name\" = '$environment'
      AND e.\"status\" IN ('running', 'stopped')
      AND e.\"activeOperationId\" IS NULL
      AND (
        (e.\"name\" = 'dev' AND a.\"devTtlHours\" IS NOT NULL) OR
        (e.\"name\" = 'test' AND a.\"testTtlHours\" IS NOT NULL)
      );
  ")
  IFS='|' read -r environment_id project_id production_fingerprint <<< "$candidate"
  [ -n "$environment_id" ] && [ -n "$project_id" ] && [ -n "$production_fingerprint" ] || \
    fail "Exactly one idle, running or stopped TTL-managed environment was not found."

  updated=$(database_scalar "
    UPDATE \"Environment\"
    SET \"expiresAt\" = now() - interval '1 minute',
        \"expiryWarningAt\" = now() - interval '2 minutes'
    WHERE \"id\" = '$environment_id'
      AND \"name\" IN ('dev', 'test')
      AND \"activeOperationId\" IS NULL
    RETURNING \"id\";
  ")
  [ "$updated" = "$environment_id" ] || fail "The environment changed before it could be armed."

  ensure_report
  temporary=$(mktemp "$ACCEPTANCE_DIR/environment-expiry.checkpoint.XXXXXX")
  chmod 600 "$temporary"
  {
    printf 'workspace=%s\n' "$workspace"
    printf 'project=%s\n' "$project"
    printf 'environment=%s\n' "$environment"
    printf 'environment_id=%s\n' "$environment_id"
    printf 'project_id=%s\n' "$project_id"
    printf 'production_fingerprint=%s\n' "$production_fingerprint"
  } > "$temporary"
  mv "$temporary" "$CHECKPOINT"
  pass "$workspace/$project $environment is armed for the next lifecycle sweep."
  printf 'Wait until the UI shows the environment as empty, then run:\n'
  printf '  ./environment-expiry-acceptance.sh verify\n'
}

verify_expiry() {
  [ -f "$CHECKPOINT" ] || fail "No environment expiry checkpoint exists."
  ensure_runtime

  local workspace project environment environment_id project_id expected_production
  local fingerprint_sql state current_production audit_count
  workspace=$(checkpoint_value workspace)
  project=$(checkpoint_value project)
  environment=$(checkpoint_value environment)
  environment_id=$(checkpoint_value environment_id)
  project_id=$(checkpoint_value project_id)
  expected_production=$(checkpoint_value production_fingerprint)
  fingerprint_sql=$(production_fingerprint_sql)

  state=$(database_scalar "
    SELECT CASE WHEN
      e.\"status\" = 'empty' AND
      e.\"expiresAt\" IS NULL AND
      e.\"expiryWarningAt\" IS NULL AND
      e.\"activeOperationId\" IS NULL AND
      e.\"version\" IS NULL AND
      e.\"buildArtifactId\" IS NULL AND
      e.\"url\" IS NULL
    THEN 'ready' ELSE 'waiting' END
    FROM \"Environment\" e
    WHERE e.\"id\" = '$environment_id'
      AND e.\"name\" IN ('dev', 'test');
  ")
  [ "$state" = ready ] || \
    fail "The lifecycle sweep has not completed safely yet; wait for the UI operation to finish and retry."

  current_production=$(database_scalar "
    SELECT $fingerprint_sql
    FROM \"Project\" p
    LEFT JOIN \"Environment\" prod
      ON prod.\"projectId\" = p.\"id\" AND prod.\"name\" = 'prod'
    WHERE p.\"id\" = '$project_id';
  ")
  [ "$current_production" = "$expected_production" ] || \
    fail "The production environment changed during the TTL acceptance."

  audit_count=$(database_scalar "
    SELECT count(*)
    FROM \"AuditEvent\"
    WHERE \"resourceId\" = '$project_id'
      AND \"action\" = 'environment.expired'
      AND \"outcome\" = 'accepted'
      AND \"details\" ->> 'environment' = '$environment';
  ")
  [ "$audit_count" -ge 1 ] || fail "The accepted environment.expired audit event is missing."

  record environment-expiry \
    "workspace=$workspace project=$project environment=$environment prod_preserved=true"
  rm -f "$CHECKPOINT"
  pass "TTL removed only $workspace/$project $environment; production and audit invariants passed."
}

case "${1:---help}" in
  arm)
    shift
    [ "$#" -eq 3 ] || { usage >&2; exit 1; }
    arm_expiry "$@"
    ;;
  verify)
    shift
    [ "$#" -eq 0 ] || { usage >&2; exit 1; }
    verify_expiry
    ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 1 ;;
esac
