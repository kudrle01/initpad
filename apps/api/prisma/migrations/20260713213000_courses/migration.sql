-- Courses organize teaching and onboarding, while linked team workspaces remain
-- the only authorization boundary for projects and targets.

ALTER TABLE "User" ADD COLUMN "platformRole" TEXT NOT NULL DEFAULT 'user';

-- Preserve a usable administrator on upgrades. A fresh install assigns the
-- first account in AuthService instead.
UPDATE "User"
SET "platformRole" = 'admin'
WHERE "id" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
);

CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "workspaceId" TEXT NOT NULL,
  "enrollmentCodeHash" TEXT,
  "enrollmentOpen" BOOLEAN NOT NULL DEFAULT true,
  "membershipLocked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseTeam" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseMember" (
  "courseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "teamId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseMember_pkey" PRIMARY KEY ("courseId", "userId")
);

CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");
CREATE UNIQUE INDEX "Course_workspaceId_key" ON "Course"("workspaceId");
CREATE UNIQUE INDEX "Course_enrollmentCodeHash_key" ON "Course"("enrollmentCodeHash");
CREATE UNIQUE INDEX "CourseTeam_workspaceId_key" ON "CourseTeam"("workspaceId");
CREATE INDEX "CourseTeam_courseId_idx" ON "CourseTeam"("courseId");
CREATE INDEX "CourseMember_userId_idx" ON "CourseMember"("userId");
CREATE INDEX "CourseMember_teamId_idx" ON "CourseMember"("teamId");

ALTER TABLE "Course"
  ADD CONSTRAINT "Course_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseTeam"
  ADD CONSTRAINT "CourseTeam_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseTeam"
  ADD CONSTRAINT "CourseTeam_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseMember"
  ADD CONSTRAINT "CourseMember_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseMember"
  ADD CONSTRAINT "CourseMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseMember"
  ADD CONSTRAINT "CourseMember_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "CourseTeam"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
