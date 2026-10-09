-- Platform events (sign-in, account administration, deleted workspaces) have
-- no workspace (ADR-142).
ALTER TABLE "AuditEvent" ALTER COLUMN "workspaceId" DROP NOT NULL;
