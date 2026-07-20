ALTER TABLE "DeploymentOperation"
ADD COLUMN "targetIdSnapshot" TEXT,
ADD COLUMN "targetName" TEXT,
ADD COLUMN "providerSnapshot" TEXT;

-- Existing audit rows predate the snapshot. Their environment's current
-- binding is the safest available backfill; all new rows capture it at start.
UPDATE "DeploymentOperation" AS operation
SET
  "targetIdSnapshot" = environment."targetId",
  "targetName" = COALESCE(target.name, environment.provider),
  "providerSnapshot" = environment.provider
FROM "Environment" AS environment
LEFT JOIN "Target" AS target ON target.id = environment."targetId"
WHERE operation."environmentId" = environment.id;

ALTER TABLE "DeploymentOperation"
ALTER COLUMN "targetName" SET NOT NULL,
ALTER COLUMN "providerSnapshot" SET NOT NULL;
