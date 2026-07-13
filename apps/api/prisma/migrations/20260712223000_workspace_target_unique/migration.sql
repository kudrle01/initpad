-- Enforce the same tenant-level uniqueness that the API validates. ownerId is
-- the credential identity, not the target ownership boundary anymore.
DROP INDEX "Target_ownerId_name_key";
CREATE UNIQUE INDEX "Target_workspaceId_name_key" ON "Target"("workspaceId", "name");
