-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED');

-- CreateTable
CREATE TABLE "transcription" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "languageCode" TEXT,
    "languageProb" DOUBLE PRECISION,
    "originalText" TEXT NOT NULL,
    "englishText" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentiment_analysis" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "label" "Sentiment" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "topics" TEXT[],
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiment_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transcription_feedbackId_key" ON "transcription"("feedbackId");

-- CreateIndex
CREATE UNIQUE INDEX "sentiment_analysis_feedbackId_key" ON "sentiment_analysis"("feedbackId");

-- CreateIndex
CREATE INDEX "sentiment_analysis_label_idx" ON "sentiment_analysis"("label");

-- AddForeignKey
ALTER TABLE "transcription" ADD CONSTRAINT "transcription_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentiment_analysis" ADD CONSTRAINT "sentiment_analysis_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same reason as the enable_rls migration: block Supabase's public REST API on new tables.
ALTER TABLE "transcription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sentiment_analysis" ENABLE ROW LEVEL SECURITY;
