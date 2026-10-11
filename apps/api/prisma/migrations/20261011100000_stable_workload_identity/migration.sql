-- Workload and image identity that survive a repository or account rename
-- (ADR-155). Both columns stay nullable so an older image can still write
-- rows; the API derives a missing value exactly as it did before.
ALTER TABLE "Project" ADD COLUMN "deploymentKey" TEXT;
ALTER TABLE "BuildArtifact" ADD COLUMN "imageRef" TEXT;

-- The value deploymentSlug() derived from the coordinates until now, so no
-- running container, SFTP path or route changes its name.
UPDATE "Project"
SET "deploymentKey" = regexp_replace(
  regexp_replace(lower("scmOwner" || '-' || "scmRepositoryName"), '[^a-z0-9-]+', '-', 'g'),
  '^-+|-+$',
  '',
  'g'
);

CREATE INDEX "Project_deploymentKey_idx" ON "Project"("deploymentKey");
-- A CI callback that arrives under a new repository name finds its project by
-- the token it carries.
CREATE INDEX "Project_ciDeployTokenHash_idx" ON "Project"("ciDeployTokenHash");
