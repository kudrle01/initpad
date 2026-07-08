-- Per-environment user deployment target (prod: your own server).
-- Secret (password or PEM key) is stored encrypted (AES-256-GCM).
ALTER TABLE "Environment" ADD COLUMN "targetKind" TEXT;
ALTER TABLE "Environment" ADD COLUMN "targetHost" TEXT;
ALTER TABLE "Environment" ADD COLUMN "targetPort" INTEGER;
ALTER TABLE "Environment" ADD COLUMN "targetUsername" TEXT;
ALTER TABLE "Environment" ADD COLUMN "targetAuth" TEXT;
ALTER TABLE "Environment" ADD COLUMN "targetSecret" TEXT;
ALTER TABLE "Environment" ADD COLUMN "targetPath" TEXT;
ALTER TABLE "Environment" ADD COLUMN "targetPublicUrl" TEXT;
