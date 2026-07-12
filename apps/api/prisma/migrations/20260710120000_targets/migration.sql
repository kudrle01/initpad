-- First-class deployment targets ("everything is a target").
--
-- Replaces the per-environment inline target columns with a reusable Target
-- resource. Built-in targets (the simulated infra) are seeded by the API on
-- startup; user targets are registered via /targets. An Environment now
-- references a Target instead of carrying connection columns.
--
-- NOTE: the old inline prod-target columns are dropped. Any prod target that
-- was configured inline (host/creds on the environment) must be re-registered
-- as a Target and re-selected on the environment.

-- 1. Target resource ---------------------------------------------------------
CREATE TABLE "Target" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "kind"         TEXT NOT NULL,
    "scope"        TEXT NOT NULL,
    "capabilities" TEXT NOT NULL,
    "host"         TEXT,
    "port"         INTEGER,
    "username"     TEXT,
    "auth"         TEXT,
    "secret"       TEXT,
    "remotePath"   TEXT,
    "publicUrl"    TEXT,
    "verifiedAt"   TIMESTAMP(3),
    "ownerId"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- A user cannot have two targets with the same name (built-ins have a null
-- owner and are keyed by a stable id at seed time).
CREATE UNIQUE INDEX "Target_ownerId_name_key" ON "Target"("ownerId", "name");

ALTER TABLE "Target"
    ADD CONSTRAINT "Target_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Environment → Target reference ------------------------------------------
ALTER TABLE "Environment" ADD COLUMN "targetId" TEXT;

ALTER TABLE "Environment"
    ADD CONSTRAINT "Environment_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Drop the superseded inline target columns -------------------------------
ALTER TABLE "Environment" DROP COLUMN "targetKind";
ALTER TABLE "Environment" DROP COLUMN "targetHost";
ALTER TABLE "Environment" DROP COLUMN "targetPort";
ALTER TABLE "Environment" DROP COLUMN "targetUsername";
ALTER TABLE "Environment" DROP COLUMN "targetAuth";
ALTER TABLE "Environment" DROP COLUMN "targetSecret";
ALTER TABLE "Environment" DROP COLUMN "targetPath";
ALTER TABLE "Environment" DROP COLUMN "targetPublicUrl";
