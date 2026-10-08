import type { z } from "zod";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { inngest } from "../inngest/client.js";
import { AppError } from "../utils/app-error.js";
import type { adminFeedbackQuerySchema } from "../validators/feedback.schema.js";
import { createPlaybackUrl, getObjectSize } from "./storage.service.js";

type Filters = z.output<typeof adminFeedbackQuerySchema>;

const PAGE_SIZE = 20;

export async function listFeedback({ cursor, status, sentiment, language, from, to }: Filters) {
  const where: Prisma.FeedbackWhereInput = {
    status,
    analysis: sentiment ? { label: sentiment } : undefined,
    transcription: language ? { languageCode: language } : undefined,
    createdAt: from || to ? { gte: from, lte: to } : undefined,
  };
  const rows = await prisma.feedback.findMany({
    where,
    select: {
      id: true,
      status: true,
      errorCode: true,
      durationMs: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      transcription: { select: { englishText: true, languageCode: true } },
      analysis: { select: { label: true, score: true, urgent: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getFeedback(id: string) {
  const feedback = await prisma.feedback.findUnique({
    where: { id },
    omit: { audioPath: true },
    include: { user: { select: { name: true, email: true } }, transcription: true, analysis: true },
  });
  if (!feedback) throw new AppError(404, "NOT_FOUND", "Recording not found");
  return feedback;
}

export async function getAudioUrl(id: string) {
  const feedback = await prisma.feedback.findUnique({ where: { id }, select: { audioPath: true, audioDeletedAt: true } });
  if (!feedback) throw new AppError(404, "NOT_FOUND", "Recording not found");
  // Audio is deleted after the retention period, so the row can outlive the file. The file check
  // also covers a deletion the cleanup job has not recorded yet
  if (feedback.audioDeletedAt || (await getObjectSize(feedback.audioPath)) === null) {
    throw new AppError(404, "AUDIO_REMOVED", "Audio has been removed");
  }
  return { url: await createPlaybackUrl(feedback.audioPath), expiresIn: 60 };
}

export async function reprocess(id: string) {
  // Conditional update, so two admins clicking at once cannot start two runs
  const { count } = await prisma.feedback.updateMany({
    where: { id, status: { in: ["FAILED", "COMPLETED"] } },
    data: { status: "UPLOADED", attempt: { increment: 1 }, errorCode: null, completedAt: null },
  });
  if (count === 0) {
    const exists = await prisma.feedback.findUnique({ where: { id }, select: { id: true } });
    throw exists
      ? new AppError(409, "INVALID_STATE", "Only completed or failed items can be reprocessed")
      : new AppError(404, "NOT_FOUND", "Recording not found");
  }

  const { attempt } = await prisma.feedback.findUniqueOrThrow({ where: { id }, select: { attempt: true } });
  try {
    // A new id per attempt, because Inngest drops events whose id it has already seen
    await inngest.send({ id: `${id}-${attempt}`, name: "feedback/uploaded", data: { feedbackId: id } });
  } catch (err) {
    logger.error({ err, feedbackId: id }, "Failed to send reprocess event");
    throw new AppError(502, "QUEUE_UNAVAILABLE", "Could not start reprocessing. Try again shortly");
  }
  return { status: "UPLOADED" as const };
}

export async function getStats() {
  const [byStatus, bySentiment, byLanguage, urgent, volume, topics] = await Promise.all([
    prisma.feedback.groupBy({ by: ["status"], _count: true }),
    prisma.sentimentAnalysis.groupBy({ by: ["label"], _count: true }),
    prisma.transcription.groupBy({ by: ["languageCode"], _count: true }),
    prisma.sentimentAnalysis.count({ where: { urgent: true } }),
    prisma.$queryRaw<{ day: Date; count: number }[]>`
      SELECT date_trunc('day', "createdAt")::date AS day, count(*)::int AS count
      FROM feedback
      WHERE "createdAt" > now() - interval '30 days'
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ topic: string; count: number }[]>`
      SELECT topic, count(*)::int AS count
      FROM sentiment_analysis, unnest(topics) AS topic
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
  ]);

  return {
    total: byStatus.reduce((sum, row) => sum + row._count, 0),
    urgent,
    byStatus: byStatus.map((r) => ({ status: r.status, count: r._count })),
    bySentiment: bySentiment.map((r) => ({ label: r.label, count: r._count })),
    byLanguage: byLanguage.map((r) => ({ language: r.languageCode ?? "unknown", count: r._count })),
    volume,
    topics,
  };
}
