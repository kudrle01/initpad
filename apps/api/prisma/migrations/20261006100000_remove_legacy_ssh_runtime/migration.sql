-- The source-based SSH runtime was already closed to new assignments. Remove
-- its unused targets and port-allocation column now that Agent-backed Docker is
-- the only application runtime. Never silently move or erase an environment:
-- an operator must first reassign every historical SSH binding.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Environment" environment
    LEFT JOIN "Target" target ON target."id" = environment."targetId"
    LEFT JOIN "TargetAllocation" allocation ON allocation."id" = environment."allocationId"
    LEFT JOIN "Target" allocation_target ON allocation_target."id" = allocation."targetId"
    WHERE environment."provider" = 'ssh'
       OR target."kind" = 'ssh'
       OR allocation_target."kind" = 'ssh'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Legacy SSH runtime removal requires every SSH environment to be reassigned first',
      HINT = 'Move or remove the affected environment in InitPad, then retry the migration.';
  END IF;
END $$;

DELETE FROM "TargetAllocation"
WHERE "targetId" IN (SELECT "id" FROM "Target" WHERE "kind" = 'ssh');

DELETE FROM "Target" WHERE "kind" = 'ssh';

ALTER TABLE "Environment" DROP COLUMN "allocatedPort";
