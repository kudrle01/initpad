-- Separates revoking InitPad management access from deleting a target. Existing
-- Environment rows and physical workloads remain untouched.
ALTER TABLE "Target"
ADD COLUMN "managementState" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "managementStateChangedAt" TIMESTAMP(3);

-- Preserve the meaning of already-disabled Agent identities after migration.
UPDATE "Target" AS target
SET
    "managementState" = 'disconnected',
    "managementStateChangedAt" = agent."disabledAt"
FROM "Agent" AS agent
WHERE agent."targetId" = target."id"
  AND agent."disabledAt" IS NOT NULL;

-- A user-owned remote target without a stored credential cannot currently be
-- managed, even if an older row still carries a verification timestamp.
UPDATE "Target"
SET
    "managementState" = 'disconnected',
    "managementStateChangedAt" = CURRENT_TIMESTAMP,
    "verifiedAt" = NULL
WHERE "scope" = 'user'
  AND "kind" IN ('ssh', 'sftp')
  AND "secret" IS NULL;

CREATE INDEX "Target_workspaceId_managementState_idx"
ON "Target"("workspaceId", "managementState");
