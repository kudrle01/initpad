-- Preserve the original pipeline for every existing project. This migration
-- changes only project metadata; environment rows and deployment history stay
-- untouched.
ALTER TABLE "Project"
ADD COLUMN "pipelinePreset" TEXT NOT NULL DEFAULT 'dev-test-prod';

ALTER TABLE "Project"
ADD CONSTRAINT "Project_pipelinePreset_check"
CHECK ("pipelinePreset" IN ('dev-test-prod', 'dev-prod', 'prod-only'));
