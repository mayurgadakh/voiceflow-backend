import { prisma } from "../config/prisma.js";
import { inngest } from "../inngest/client.js";
import { deleteObjects } from "./storage.service.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** How long a customer has to finish uploading before the recording is given up on. */
export const UPLOAD_TIMEOUT_MS = 15 * MINUTE;
/** How long an uploaded recording may wait for processing to start before it is queued again. */
export const STUCK_AFTER_MS = 5 * MINUTE;
/** How long audio is kept. The transcript and analysis stay after the audio is gone. */
export const AUDIO_RETENTION_DAYS = 30;
/** Work per run, so one run stays short. Anything left over is picked up by the next run. */
export const BATCH_SIZE = 100;

/**
 * A recording whose upload was never confirmed (tab closed, network lost) is marked EXPIRED.
 * One conditional statement, so it cannot race with a customer confirming at the same moment.
 */
export async function expireAbandonedUploads(now: Date) {
  const { count } = await prisma.feedback.updateMany({
    where: { status: "UPLOADING", createdAt: { lt: new Date(now.getTime() - UPLOAD_TIMEOUT_MS) } },
    data: { status: "EXPIRED", errorCode: "UPLOAD_EXPIRED" },
  });
  return count;
}

/**
 * A confirmed recording whose job never started (the event could not be sent, or was lost) is queued again.
 * The event id is new each run. The processing function holds one run per recording at a time and ignores
 * a recording that is already handled, so a repeat is harmless.
 */
export async function requeueStuckUploads(now: Date) {
  const stuck = await prisma.feedback.findMany({
    where: { status: "UPLOADED", updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    select: { id: true, attempt: true },
    take: BATCH_SIZE,
  });
  if (stuck.length === 0) return 0;

  await inngest.send(
    stuck.map(({ id, attempt }) => ({
      id: `${id}-${attempt}-rescue-${now.getTime()}`,
      name: "feedback/uploaded",
      data: { feedbackId: id },
    })),
  );
  return stuck.length;
}

/**
 * Deletes audio that is no longer needed: files from expired uploads, and everything past the retention period.
 * The row is only marked after the file is gone, so a failed delete is tried again on the next run.
 */
export async function deleteUnneededAudio(now: Date) {
  const retentionCutoff = new Date(now.getTime() - AUDIO_RETENTION_DAYS * DAY);
  const rows = await prisma.feedback.findMany({
    where: { audioDeletedAt: null, OR: [{ status: "EXPIRED" }, { createdAt: { lt: retentionCutoff } }] },
    select: { id: true, audioPath: true },
    take: BATCH_SIZE,
  });
  if (rows.length === 0) return 0;

  await deleteObjects(rows.map((row) => row.audioPath));
  await prisma.feedback.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { audioDeletedAt: now } });
  return rows.length;
}
