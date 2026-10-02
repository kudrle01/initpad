CREATE TABLE "ControlPlaneLease" (
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneLease_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "ControlPlaneLease_expiresAt_idx" ON "ControlPlaneLease"("expiresAt");
