#!/usr/bin/env bash
# Semantic contract test for restore-reconcile.sql. It uses temporary tables in
# the existing PostgreSQL container, runs inside one transaction and rolls back;
# no InitPad row or volume is changed.
set -euo pipefail
cd "$(dirname "$0")"

tmp=$(mktemp "${TMPDIR:-/tmp}/initpad-restore-reconcile.XXXXXX.sql")
trap 'rm -f "$tmp"' EXIT

{
  command cat <<'SQL'
BEGIN;

CREATE TEMP TABLE "Environment" (
  "id" text PRIMARY KEY, "status" text, "statusReason" text,
  "deploymentRequired" boolean, "activeOperationId" text, "url" text,
  "provider" text, "version" text
);
CREATE TEMP TABLE "DeploymentOperation" (
  "id" text PRIMARY KEY, "status" text, "phase" text, "message" text,
  "finishedAt" timestamptz
);
CREATE TEMP TABLE "AgentJob" (
  "id" text PRIMARY KEY, "status" text, "progressStage" text,
  "progressPercent" integer, "message" text, "resultCode" text,
  "result" jsonb, "leasedByAgentId" text, "leaseTokenHash" text,
  "leasedAt" timestamptz, "leaseExpiresAt" timestamptz,
  "finishedAt" timestamptz
);
CREATE TEMP TABLE "GatewayRoute" (
  "id" text PRIMARY KEY, "desiredState" text, "desiredRevision" text,
  "observedState" text, "observedRevision" text,
  "observedGeneration" integer, "reconcileJobId" text,
  "lastError" text, "reconciledAt" timestamptz
);
CREATE TEMP TABLE "WorkloadDiagnostic" (
  "id" text PRIMARY KEY, "currentJobId" text, "status" text,
  "runtimeState" text, "revision" text, "exitCode" integer, "health" text,
  "logs" text, "message" text, "observedAt" timestamptz,
  "finishedAt" timestamptz
);
CREATE TEMP TABLE "Target" (
  "id" text PRIMARY KEY, "gatewayPreflightStatus" text,
  "gatewayPreflightJobId" text, "gatewayPreflightAt" timestamptz,
  "gatewayPreflightError" text
);
CREATE TEMP TABLE "ProvisioningOperation" (
  "id" text PRIMARY KEY, "status" text, "message" text,
  "finishedAt" timestamptz, "leaseOwner" text, "leaseExpiresAt" timestamptz
);
CREATE TEMP TABLE "ProvisioningEffect" (
  "id" text PRIMARY KEY, "status" text, "error" text
);

INSERT INTO "Environment" VALUES
  ('runtime', 'running', NULL, false, 'operation', 'http://runtime.invalid', 'docker', 'rev-1'),
  ('empty', 'empty', NULL, false, NULL, NULL, 'docker', NULL);
INSERT INTO "DeploymentOperation" VALUES
  ('active', 'running', 'verifying', NULL, NULL),
  ('terminal', 'succeeded', 'succeeded', 'done', NOW());
INSERT INTO "AgentJob" VALUES
  ('leased', 'leased', 'running', 50, 'working', NULL, '{"state":"running"}',
   'agent', 'lease', NOW(), NOW() + INTERVAL '30 seconds', NULL),
  ('terminal', 'succeeded', 'succeeded', 100, 'done', 'ok', '{}',
   NULL, NULL, NULL, NULL, NOW());
INSERT INTO "GatewayRoute" VALUES
  ('route', 'active', 'rev-1', 'active', 'rev-1', 7, 'leased', NULL, NOW());
INSERT INTO "WorkloadDiagnostic" VALUES
  ('diagnostic', 'leased', 'succeeded', 'running', 'rev-1', 0, 'healthy',
   'application output', 'healthy', NOW(), NOW());
INSERT INTO "Target" VALUES
  ('checking', 'running', 'leased', NOW(), NULL),
  ('passed', 'passed', 'terminal', NOW(), NULL);
INSERT INTO "ProvisioningOperation" VALUES
  ('provisioning', 'running', 'working', NULL, 'api-1', NOW()),
  ('provisioned', 'succeeded', 'done', NOW(), NULL, NULL);
INSERT INTO "ProvisioningEffect" VALUES
  ('applying', 'applying', NULL), ('applied', 'applied', NULL);
SQL

  command cat ./restore-reconcile.sql

  command cat <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Environment"
    WHERE "id" = 'runtime' AND "status" = 'failed'
      AND "deploymentRequired" AND "activeOperationId" IS NULL
      AND "url" IS NULL AND "version" = 'rev-1'
  ) THEN RAISE EXCEPTION 'runtime environment still claims restored state'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Environment"
    WHERE "id" = 'empty' AND "status" = 'empty' AND NOT "deploymentRequired"
  ) THEN RAISE EXCEPTION 'empty environment was changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "DeploymentOperation"
    WHERE "id" = 'active' AND "status" = 'failed' AND "phase" = 'failed'
      AND "finishedAt" IS NOT NULL
  ) THEN RAISE EXCEPTION 'active deployment operation was not terminated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "AgentJob"
    WHERE "id" = 'leased' AND "status" = 'cancelled'
      AND "progressStage" = 'cancelled' AND "progressPercent" = 100
      AND "resultCode" = 'control_plane_restored' AND "result" IS NULL
      AND "leasedByAgentId" IS NULL AND "leaseTokenHash" IS NULL
      AND "leaseExpiresAt" IS NULL AND "finishedAt" IS NOT NULL
  ) THEN RAISE EXCEPTION 'restored Agent job retained target authority'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "AgentJob" WHERE "id" = 'terminal' AND "status" = 'succeeded'
  ) THEN RAISE EXCEPTION 'terminal Agent history was changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "GatewayRoute"
    WHERE "id" = 'route' AND "desiredState" = 'reserved'
      AND "desiredRevision" IS NULL AND "observedState" = 'failed'
      AND "observedRevision" IS NULL AND "observedGeneration" = 0
      AND "reconcileJobId" IS NULL AND "reconciledAt" IS NULL
  ) THEN RAISE EXCEPTION 'gateway projection still claims restored runtime state'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WorkloadDiagnostic"
    WHERE "id" = 'diagnostic' AND "status" = 'failed'
      AND "currentJobId" IS NULL AND "runtimeState" IS NULL
      AND "health" IS NULL AND "logs" = '' AND "observedAt" IS NULL
  ) THEN RAISE EXCEPTION 'stale workload diagnostics survived restore'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Target"
    WHERE "id" = 'checking' AND "gatewayPreflightStatus" = 'failed'
      AND "gatewayPreflightJobId" IS NULL
  ) THEN RAISE EXCEPTION 'interrupted gateway preflight survived restore'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Target"
    WHERE "id" = 'passed' AND "gatewayPreflightStatus" = 'passed'
  ) THEN RAISE EXCEPTION 'completed gateway preflight was changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ProvisioningOperation"
    WHERE "id" = 'provisioning' AND "status" = 'interrupted'
      AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL
  ) THEN RAISE EXCEPTION 'provisioning lease survived restore'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ProvisioningEffect"
    WHERE "id" = 'applying' AND "status" = 'reconciliation_required'
  ) THEN RAISE EXCEPTION 'applying external effect survived restore'; END IF;
END $$;

ROLLBACK;
SQL
} > "$tmp"

docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U initpad -d initpad < "$tmp" >/dev/null

printf '\033[1;32m✔\033[0m Restore reconciliation contract passed; live data was not changed.\n'
