import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";
import { AUDIO_EXTENSIONS, type registerFeedbackSchema } from "../validators/feedback.schema.js";
import type { z } from "zod";
import { inngest } from "../inngest/client.js";
import { logger } from "../config/logger.js";
import { createUploadUrl, getObjectSize } from "./storage.service.js";

type RegisterInput = z.output<typeof registerFeedbackSchema>;

const publicFields = {
  id: true,
  status: true,
  durationMs: true,
  errorCode: true,
  createdAt: true,
  completedAt: true,
  // Sentiment is for admins only, so customers never get the analysis relation
  transcription: { select: { originalText: true, englishText: true, languageCode: true } },
} as const;

export async function registerFeedback(userId: string, input: RegisterInput) {
  const id = randomUUID();
  // The server builds the path, so a client can never write outside its own folder
  const audioPath = `${userId}/${id}.${AUDIO_EXTENSIONS[input.mimeType]}`;

  await prisma.feedback.create({
    data: {
      id,
      userId,
      audioPath,
      consentAt: new Date(),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
      languageHint: input.languageHint,
    },
  });
  const uploadUrl = await createUploadUrl(audioPath, input.mimeType, input.sizeBytes);
  return { id, uploadUrl };
}

export async function completeUpload(userId: string, id: string) {
  // Someone else's recording looks identical to a missing one
  const feedback = await prisma.feedback.findFirst({ where: { id, userId } });
  if (!feedback) throw new AppError(404, "NOT_FOUND", "Recording not found");
  if (feedback.status !== "UPLOADING") throw new AppError(409, "INVALID_STATE", "Upload already confirmed");

  const size = await getObjectSize(feedback.audioPath);
  if (size !== feedback.sizeBytes) throw new AppError(400, "UPLOAD_MISSING", "The audio file was not uploaded correctly");

  // Conditional update, so a double click on confirm cannot move the row twice
  const { count } = await prisma.feedback.updateMany({ where: { id, status: "UPLOADING" }, data: { status: "UPLOADED" } });
  if (count === 0) throw new AppError(409, "INVALID_STATE", "Upload already confirmed");

  // The event id makes a retried confirm a no-op. If sending fails the row stays UPLOADED,
  // and the scheduled recovery job (phase 5) re-sends it
  try {
    await inngest.send({ id: `${id}-${feedback.attempt}`, name: "feedback/uploaded", data: { feedbackId: id } });
  } catch (err) {
    logger.error({ err, feedbackId: id }, "Failed to send feedback/uploaded event");
  }
  return { status: "UPLOADED" as const };
}

export async function getFeedback(userId: string, id: string) {
  const feedback = await prisma.feedback.findFirst({ where: { id, userId }, select: publicFields });
  if (!feedback) throw new AppError(404, "NOT_FOUND", "Recording not found");
  return feedback;
}

const PAGE_SIZE = 20;

export async function listFeedback(userId: string, cursor?: string) {
  const rows = await prisma.feedback.findMany({
    where: { userId },
    select: publicFields,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
