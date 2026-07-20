ALTER TABLE "Environment"
ADD COLUMN "deploymentRequired" BOOLEAN NOT NULL DEFAULT false;

-- An operation in flight during the rollout represents a deployment intent.
-- If the API restart interrupts it, the environment must offer Deploy rather
-- than falling back to the ambiguous legacy Run again state.
UPDATE "Environment"
SET "deploymentRequired" = true
WHERE "activeOperationId" IS NOT NULL;
