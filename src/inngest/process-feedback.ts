import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { analyseSentiment } from "../services/sentiment.service.js";
import { transcribe } from "../services/speech.service.js";
import { getObjectBytes } from "../services/storage.service.js";
import { inngest } from "./client.js";

const ERROR_CODES = ["SPEECH_REJECTED", "NO_SPEECH", "ANALYSIS_INVALID"];

export const processFeedback = inngest.createFunction(
  {
    id: "process-feedback",
    triggers: [{ event: "feedback/uploaded" }],
    retries: 3,
    // A rescued or duplicated event must never run beside the original. The second one waits,
    // then finds the item already handled and stops
    concurrency: { limit: 1, key: "event.data.feedbackId" },
    // Each run makes two Sarvam calls, and the starter plan allows 60 requests a minute
    throttle: { limit: 25, period: "1m" },
    onFailure: async ({ event, error }) => {
      const feedbackId = event.data.event.data.feedbackId as string;
      const errorCode = ERROR_CODES.includes(error.message) ? error.message : "PROCESSING_FAILED";
      await prisma.feedback.update({ where: { id: feedbackId }, data: { status: "FAILED", errorCode } });
      logger.warn({ feedbackId, errorCode }, "Feedback processing failed");
    },
  },
  async ({ event, step }) => {
    const feedbackId = event.data.feedbackId as string;

    // Takes ownership of the row. A duplicate or stale event finds it already moved on and stops
    const feedback = await step.run("claim", async () => {
      const { count } = await prisma.feedback.updateMany({
        where: { id: feedbackId, status: { in: ["UPLOADED", "PROCESSING"] } },
        data: { status: "PROCESSING", errorCode: null },
      });
      if (count === 0) return null;
      const row = await prisma.feedback.findUniqueOrThrow({ where: { id: feedbackId } });
      return { audioPath: row.audioPath, mimeType: row.mimeType, languageHint: row.languageHint };
    });
    if (!feedback) return { skipped: true };

    // Saved before sentiment runs, so a sentiment failure never repeats the paid Sarvam calls
    const englishText = await step.run("speech", async () => {
      const existing = await prisma.transcription.findUnique({ where: { feedbackId } });
      if (existing) return existing.englishText;

      const audio = await getObjectBytes(feedback.audioPath);
      const speech = await transcribe(audio, feedback.mimeType, feedback.languageHint);
      await prisma.transcription.create({ data: { feedbackId, ...speech } });
      return speech.englishText;
    });

    await step.run("sentiment", async () => {
      const analysis = await analyseSentiment(englishText);
      await prisma.$transaction([
        prisma.sentimentAnalysis.upsert({ where: { feedbackId }, create: { feedbackId, ...analysis }, update: analysis }),
        prisma.feedback.update({ where: { id: feedbackId }, data: { status: "COMPLETED", completedAt: new Date() } }),
      ]);
    });

    return { feedbackId };
  },
);
