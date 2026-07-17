-- Explicit, provider-neutral repository identity (ADR-043). Existing projects
-- are Gitea-backed. Their owner/name coordinates are backfilled without a
-- network dependency; the real immutable Gitea repository id stays NULL until
-- startup reconciliation can resolve it safely from Gitea.

ALTER TABLE "Project"
  ADD COLUMN "scmProvider" TEXT NOT NULL DEFAULT 'gitea',
  ADD COLUMN "scmRepositoryId" TEXT,
  ADD COLUMN "scmOwner" TEXT,
  ADD COLUMN "scmRepositoryName" TEXT,
  ADD COLUMN "scmFullName" TEXT,
  ADD COLUMN "scmDefaultBranch" TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN "scmInstallationId" TEXT;

-- Prefer the browser URL because it records the actual repository owner. Fall
-- back to the legacy owner relation, then an explicit sentinel rather than
-- silently inventing another user's namespace.
UPDATE "Project" AS p
SET
  "scmOwner" = COALESCE(
    NULLIF(substring(p."repoUrl" from '^https?://[^/]+/([^/]+)'), ''),
    u."username",
    'legacy'
  ),
  "scmRepositoryName" = p."name"
FROM "User" AS u
WHERE p."ownerId" = u."id";

UPDATE "Project"
SET
  "scmOwner" = COALESCE(
    "scmOwner",
    NULLIF(substring("repoUrl" from '^https?://[^/]+/([^/]+)'), ''),
    'legacy'
  ),
  "scmRepositoryName" = COALESCE("scmRepositoryName", "name");

UPDATE "Project"
SET "scmFullName" = "scmOwner" || '/' || "scmRepositoryName";

ALTER TABLE "Project"
  ALTER COLUMN "scmOwner" SET NOT NULL,
  ALTER COLUMN "scmRepositoryName" SET NOT NULL,
  ALTER COLUMN "scmFullName" SET NOT NULL;

CREATE UNIQUE INDEX "Project_scmProvider_scmRepositoryId_key"
  ON "Project"("scmProvider", "scmRepositoryId");
CREATE INDEX "Project_scmProvider_scmFullName_idx"
  ON "Project"("scmProvider", "scmFullName");
CREATE INDEX "Project_scmInstallationId_idx"
  ON "Project"("scmInstallationId");

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_scmInstallationId_fkey"
  FOREIGN KEY ("scmInstallationId") REFERENCES "GitHubInstallation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
