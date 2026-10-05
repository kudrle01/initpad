-- A user-owned SSH/SFTP target has one derived workspace allocation whose root
-- path mirrors Target.remotePath and is not independently editable. Editing the
-- target used to leave that allocation on the previous path, so Test connection
-- passed against the new root while deployments kept writing to the stale one.
-- Shared built-in targets are skipped: their allocations carry a deliberate
-- per-workspace suffix.
UPDATE "TargetAllocation" AS allocation
SET
    "rootPath" = target."remotePath",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Target" AS target
WHERE allocation."targetId" = target."id"
  AND target."scope" = 'user'
  AND target."kind" IN ('ssh', 'sftp')
  AND allocation."rootPath" IS DISTINCT FROM target."remotePath";
