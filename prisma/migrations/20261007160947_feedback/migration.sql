-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "audioPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "languageHint" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'UPLOADING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_audioPath_key" ON "feedback"("audioPath");

-- CreateIndex
CREATE INDEX "feedback_status_createdAt_idx" ON "feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_userId_createdAt_idx" ON "feedback"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same reason as the enable_rls migration: block Supabase's public REST API on new tables.
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
