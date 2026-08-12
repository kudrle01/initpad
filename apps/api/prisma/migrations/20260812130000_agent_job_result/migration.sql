-- Structured, non-secret outcome needed to reconcile a durable Agent job with
-- its DeploymentOperation even after a control-plane restart.
ALTER TABLE "AgentJob" ADD COLUMN "result" JSONB;
