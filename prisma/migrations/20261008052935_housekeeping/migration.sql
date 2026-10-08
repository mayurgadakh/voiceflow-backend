-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "audioDeletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "feedback_status_updatedAt_idx" ON "feedback"("status", "updatedAt");
