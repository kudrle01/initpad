-- Invalidate control-plane projections that cannot be proven after restoring a
-- historical database checkpoint. Runtime targets are deliberately not part of
-- the backup atom and may have changed while the control plane was offline.

UPDATE "Environment"
SET "status" = 'failed',
    "statusReason" = 'Control plane restored; verify the target state and deploy again.',
    "deploymentRequired" = true,
    "activeOperationId" = NULL,
    "url" = CASE WHEN "provider" = 'docker' THEN NULL ELSE "url" END
WHERE "status" <> 'empty'
   OR "version" IS NOT NULL
   OR "url" IS NOT NULL
   OR "activeOperationId" IS NOT NULL;

UPDATE "DeploymentOperation"
SET "status" = 'failed',
    "phase" = 'failed',
    "message" = 'Interrupted by control-plane restore; target reconciliation is required.',
    "finishedAt" = NOW()
WHERE "status" = 'running';

-- A queued or leased command from the restored timeline must never mutate a
-- target. A user starts a fresh, audited operation after verifying the target.
UPDATE "AgentJob"
SET "status" = 'cancelled',
    "progressStage" = 'cancelled',
    "progressPercent" = 100,
    "message" = 'Cancelled by control-plane restore; create a new operation.',
    "resultCode" = 'control_plane_restored',
    "result" = NULL,
    "leasedByAgentId" = NULL,
    "leaseTokenHash" = NULL,
    "leasedAt" = NULL,
    "leaseExpiresAt" = NULL,
    "finishedAt" = NOW()
WHERE "status" IN ('blocked', 'queued', 'leased');

-- Gateway reservations remain stable, but desired/observed runtime projections
-- are no longer evidence. The next deployment increments the generation and
-- performs a fresh health-gated reconcile using the same reserved hostname.
UPDATE "GatewayRoute"
SET "desiredState" = 'reserved',
    "desiredRevision" = NULL,
    "observedState" = 'failed',
    "observedRevision" = NULL,
    "observedGeneration" = 0,
    "reconcileJobId" = NULL,
    "lastError" = 'Control plane restored; gateway state requires a fresh deployment.',
    "reconciledAt" = NULL;

-- Diagnostics are a latest-observation cache, not durable runtime truth.
UPDATE "WorkloadDiagnostic"
SET "currentJobId" = NULL,
    "status" = 'failed',
    "runtimeState" = NULL,
    "revision" = NULL,
    "exitCode" = NULL,
    "health" = NULL,
    "logs" = '',
    "message" = 'Control plane restored; refresh diagnostics after redeploy.',
    "observedAt" = NULL,
    "finishedAt" = NOW();

UPDATE "Target"
SET "gatewayPreflightStatus" = 'failed',
    "gatewayPreflightJobId" = NULL,
    "gatewayPreflightAt" = NULL,
    "gatewayPreflightError" = 'Control plane restored during gateway preflight; run it again.'
WHERE "gatewayPreflightStatus" IN ('queued', 'running');

UPDATE "ProvisioningOperation"
SET "status" = 'interrupted',
    "message" = 'Interrupted by control-plane restore; external effects require reconciliation.',
    "finishedAt" = NOW(),
    "leaseOwner" = NULL,
    "leaseExpiresAt" = NULL
WHERE "status" IN ('running', 'cleaning', 'retrying');

UPDATE "ProvisioningEffect"
SET "status" = 'reconciliation_required',
    "error" = 'Control plane was restored while this effect may have been applying.'
WHERE "status" = 'applying';
