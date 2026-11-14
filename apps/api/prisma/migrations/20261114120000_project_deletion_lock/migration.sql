-- Additive: compare-and-set lock for project deletion (ADR-177).
ALTER TABLE "Project" ADD COLUMN "deletionStartedAt" TIMESTAMP(3);
