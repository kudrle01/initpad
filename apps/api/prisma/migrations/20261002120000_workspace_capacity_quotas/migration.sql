ALTER TABLE "Workspace"
ADD COLUMN "maxProjects" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN "maxMembers" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "maxTargets" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN "maxConcurrentOperations" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "maxArtifactBytes" BIGINT NOT NULL DEFAULT 21474836480;

ALTER TABLE "Workspace"
ADD CONSTRAINT "Workspace_maxProjects_positive" CHECK ("maxProjects" > 0),
ADD CONSTRAINT "Workspace_maxMembers_positive" CHECK ("maxMembers" > 0),
ADD CONSTRAINT "Workspace_maxTargets_positive" CHECK ("maxTargets" > 0),
ADD CONSTRAINT "Workspace_maxConcurrentOperations_positive" CHECK ("maxConcurrentOperations" > 0),
ADD CONSTRAINT "Workspace_maxArtifactBytes_positive" CHECK ("maxArtifactBytes" > 0);
