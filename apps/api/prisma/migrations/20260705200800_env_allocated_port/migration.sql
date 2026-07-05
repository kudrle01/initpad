/*
  Warnings:

  - A unique constraint covering the columns `[allocatedPort]` on the table `Environment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Environment" ADD COLUMN     "allocatedPort" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Environment_allocatedPort_key" ON "Environment"("allocatedPort");
