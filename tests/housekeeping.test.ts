import { beforeEach, describe, expect, it } from "vitest";
import { housekeeping } from "../src/inngest/housekeeping.js";
import {
  AUDIO_RETENTION_DAYS,
  BATCH_SIZE,
  deleteUnneededAudio,
  expireAbandonedUploads,
  requeueStuckUploads,
  STUCK_AFTER_MS,
  UPLOAD_TIMEOUT_MS,
} from "../src/services/housekeeping.service.js";
import { inngestMock, prismaMock, storageMock } from "./helpers/mocks.js";

const now = new Date("2026-10-08T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60_000);

describe("expireAbandonedUploads", () => {
  it("expires uploads that were never confirmed within 15 minutes, in one conditional statement", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 3 });

    expect(await expireAbandonedUploads(now)).toBe(3);

    expect(prismaMock.feedback.updateMany).toHaveBeenCalledWith({
      where: { status: "UPLOADING", createdAt: { lt: minutesAgo(15) } },
      data: { status: "EXPIRED", errorCode: "UPLOAD_EXPIRED" },
    });
  });

  it("uses a 15 minute timeout", () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it("does nothing when there is nothing to expire", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 0 });
    expect(await expireAbandonedUploads(now)).toBe(0);
  });
});

describe("requeueStuckUploads", () => {
  it("looks only at recordings that have waited longer than 5 minutes since their last change", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    await requeueStuckUploads(now);
    expect(prismaMock.feedback.findMany).toHaveBeenCalledWith({
      where: { status: "UPLOADED", updatedAt: { lt: minutesAgo(5) } },
      select: { id: true, attempt: true },
      take: BATCH_SIZE,
    });
    expect(STUCK_AFTER_MS).toBe(5 * 60_000);
  });

  it("sends the processing event again for each stuck recording", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([
      { id: "a", attempt: 1 },
      { id: "b", attempt: 3 },
    ]);

    expect(await requeueStuckUploads(now)).toBe(2);

    expect(inngestMock.send).toHaveBeenCalledOnce();
    const events = inngestMock.send.mock.calls[0]![0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ name: "feedback/uploaded", data: { feedbackId: "a" } });
    expect(events[1]).toMatchObject({ name: "feedback/uploaded", data: { feedbackId: "b" } });
  });

  it("uses a new event id each run, because Inngest drops an id it has already seen", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([{ id: "a", attempt: 1 }]);
    await requeueStuckUploads(now);
    await requeueStuckUploads(new Date(now.getTime() + 10 * 60_000));

    const first = inngestMock.send.mock.calls[0]![0][0].id;
    const second = inngestMock.send.mock.calls[1]![0][0].id;
    expect(first).toMatch(/^a-1-rescue-/);
    expect(second).not.toBe(first);
  });

  it("sends nothing when no recording is stuck", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    expect(await requeueStuckUploads(now)).toBe(0);
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("lets an error from the queue through, so the step is retried", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([{ id: "a", attempt: 1 }]);
    inngestMock.send.mockRejectedValue(new Error("queue down"));
    await expect(requeueStuckUploads(now)).rejects.toThrow("queue down");
  });
});

describe("deleteUnneededAudio", () => {
  it("selects audio from expired uploads and audio older than the retention period, and nothing already deleted", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    await deleteUnneededAudio(now);
    expect(prismaMock.feedback.findMany).toHaveBeenCalledWith({
      where: { audioDeletedAt: null, OR: [{ status: "EXPIRED" }, { createdAt: { lt: daysAgo(30) } }] },
      select: { id: true, audioPath: true },
      take: BATCH_SIZE,
    });
    expect(AUDIO_RETENTION_DAYS).toBe(30);
  });

  it("deletes the files, then records that they are gone", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([
      { id: "a", audioPath: "u1/a.webm" },
      { id: "b", audioPath: "u2/b.mp4" },
    ]);
    storageMock.deleteObjects.mockResolvedValue(undefined);

    expect(await deleteUnneededAudio(now)).toBe(2);

    expect(storageMock.deleteObjects).toHaveBeenCalledWith(["u1/a.webm", "u2/b.mp4"]);
    expect(prismaMock.feedback.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } }, data: { audioDeletedAt: now } });
    expect(storageMock.deleteObjects.mock.invocationCallOrder[0]).toBeLessThan(prismaMock.feedback.updateMany.mock.invocationCallOrder[0]!);
  });

  it("does not mark anything as deleted when the delete fails, so the next run tries again", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([{ id: "a", audioPath: "u1/a.webm" }]);
    storageMock.deleteObjects.mockRejectedValue(new Error("storage down"));

    await expect(deleteUnneededAudio(now)).rejects.toThrow("storage down");
    expect(prismaMock.feedback.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when there is no audio to delete", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    expect(await deleteUnneededAudio(now)).toBe(0);
    expect(storageMock.deleteObjects).not.toHaveBeenCalled();
  });
});

describe("the scheduled function", () => {
  const fn = housekeeping as unknown as {
    options: { triggers: { cron: string }[] };
    handler: (ctx: { step: unknown }) => Promise<unknown>;
  };
  const step = { run: async (_name: string, work: () => Promise<unknown>) => work() };

  it("runs every 10 minutes", () => {
    expect(fn.options.triggers).toEqual([{ cron: "*/10 * * * *" }]);
  });

  it("runs the three tasks and reports what it did", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.feedback.findMany.mockResolvedValueOnce([{ id: "a", attempt: 1 }]).mockResolvedValueOnce([{ id: "x", audioPath: "u/x.webm" }]);

    expect(await fn.handler({ step })).toEqual({ expired: 2, requeued: 1, audioDeleted: 1 });
  });
});

describe("the processing function protects against a rescued or duplicated event", () => {
  it("allows one run per recording at a time", async () => {
    const { processFeedback } = await import("../src/inngest/process-feedback.js");
    const { options } = processFeedback as unknown as { options: { concurrency: unknown } };
    expect(options.concurrency).toEqual({ limit: 1, key: "event.data.feedbackId" });
  });
});
