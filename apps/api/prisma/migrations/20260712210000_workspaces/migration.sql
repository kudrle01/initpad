-- Introduce the tenant boundary without moving existing repositories.
-- Every existing user receives a deterministic personal workspace; their
-- projects and user-owned targets are assigned to it. ownerId stays in place
-- as the SCM/credential identity and is no longer the authorization boundary.

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

CREATE TABLE "WorkspaceMember" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspaceId", "userId")
);

CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

ALTER TABLE "WorkspaceMember"
    ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember"
    ADD CONSTRAINT "WorkspaceMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Workspace" ("id", "slug", "name", "type", "createdAt")
SELECT 'personal-' || "id", LOWER("username"),
       COALESCE(NULLIF("name", ''), "username") || '''s workspace',
       'personal', "createdAt"
FROM "User";

INSERT INTO "WorkspaceMember" ("workspaceId", "userId", "role", "createdAt")
SELECT 'personal-' || "id", "id", 'owner', "createdAt"
FROM "User";

ALTER TABLE "Project" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Target" ADD COLUMN "workspaceId" TEXT;

UPDATE "Project"
SET "workspaceId" = 'personal-' || "ownerId"
WHERE "ownerId" IS NOT NULL;

UPDATE "Target"
SET "workspaceId" = 'personal-' || "ownerId"
WHERE "ownerId" IS NOT NULL AND "scope" = 'user';

-- An ownerless legacy project has no safe tenant to infer. Stop rather than
-- silently exposing it to an arbitrary account.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "workspaceId" IS NULL) THEN
    RAISE EXCEPTION 'Ownerless legacy projects must be assigned before the workspace migration';
  END IF;
END $$;

ALTER TABLE "Project" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Project"
    ADD CONSTRAINT "Project_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Target"
    ADD CONSTRAINT "Target_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "Project_ownerId_name_key";
CREATE UNIQUE INDEX "Project_workspaceId_name_key" ON "Project"("workspaceId", "name");
