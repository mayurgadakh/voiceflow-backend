import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FEEDBACK_ID, feedbackRow } from "./helpers/fixtures.js";
import { ADMIN, call, loginAs, startServer } from "./helpers/http.js";
import { inngestMock, prismaMock, storageMock } from "./helpers/mocks.js";

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());
beforeEach(() => loginAs(ADMIN));

describe("GET /api/admin/feedback", () => {
  it("passes every filter to the database query", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    const qs = "status=COMPLETED&sentiment=NEGATIVE&language=hi-IN&from=2026-10-01&to=2026-10-07T23:59:59.999";
    const res = await call(server.base, `/api/admin/feedback?${qs}`);

    expect(res.status).toBe(200);
    const { where } = prismaMock.feedback.findMany.mock.calls[0]![0];
    expect(where.status).toBe("COMPLETED");
    expect(where.analysis).toEqual({ label: "NEGATIVE" });
    expect(where.transcription).toEqual({ languageCode: "hi-IN" });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
  });

  it("applies no filters when none are given", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    await call(server.base, "/api/admin/feedback");
    const { where } = prismaMock.feedback.findMany.mock.calls[0]![0];
    expect(where).toEqual({ status: undefined, analysis: undefined, transcription: undefined, createdAt: undefined });
  });

  it.each([
    ["an unknown sentiment", "sentiment=HAPPY"],
    ["an unknown status", "status=DONE"],
    ["an unsupported language", "language=xx-YY"],
    ["a date that is not a date", "from=yesterday-ish"],
    ["a cursor that is not a UUID", "cursor=abc"],
  ])("rejects %s with 400", async (_name, qs) => {
    const res = await call(server.base, `/api/admin/feedback?${qs}`);
    expect(res.status).toBe(400);
    expect(prismaMock.feedback.findMany).not.toHaveBeenCalled();
  });

  it("pages like the customer list", async () => {
    prismaMock.feedback.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: `id-${i}` })));
    const res = await call(server.base, "/api/admin/feedback");
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBe("id-19");
  });
});

describe("GET /api/admin/feedback/:id", () => {
  it("answers 404 for an unknown recording", async () => {
    prismaMock.feedback.findUnique.mockResolvedValue(null);
    expect((await call(server.base, `/api/admin/feedback/${FEEDBACK_ID}`)).status).toBe(404);
  });

  it("includes transcript and analysis but never the storage path", async () => {
    prismaMock.feedback.findUnique.mockResolvedValue({ id: FEEDBACK_ID });
    await call(server.base, `/api/admin/feedback/${FEEDBACK_ID}`);
    const args = prismaMock.feedback.findUnique.mock.calls[0]![0];
    expect(args.omit).toEqual({ audioPath: true });
    expect(args.include.transcription).toBe(true);
    expect(args.include.analysis).toBe(true);
  });
});

describe("GET /api/admin/feedback/:id/audio", () => {
  it("answers 404 AUDIO_REMOVED once the file is gone (after the retention period)", async () => {
    prismaMock.feedback.findUnique.mockResolvedValue({ audioPath: "u/x.webm" });
    storageMock.getObjectSize.mockResolvedValue(null);
    const res = await call(server.base, `/api/admin/feedback/${FEEDBACK_ID}/audio`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("AUDIO_REMOVED");
  });

  it("answers AUDIO_REMOVED straight away when the cleanup job has recorded the deletion", async () => {
    prismaMock.feedback.findUnique.mockResolvedValue({ audioPath: "u/x.webm", audioDeletedAt: new Date() });
    const res = await call(server.base, `/api/admin/feedback/${FEEDBACK_ID}/audio`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("AUDIO_REMOVED");
    expect(storageMock.getObjectSize).not.toHaveBeenCalled();
  });

  it("returns a short-lived playback URL", async () => {
    prismaMock.feedback.findUnique.mockResolvedValue({ audioPath: "u/x.webm" });
    storageMock.getObjectSize.mockResolvedValue(100);
    storageMock.createPlaybackUrl.mockResolvedValue("https://storage.test/play?signed=1");
    const res = await call(server.base, `/api/admin/feedback/${FEEDBACK_ID}/audio`);
    expect(res.body).toEqual({ url: "https://storage.test/play?signed=1", expiresIn: 60 });
    expect(storageMock.createPlaybackUrl).toHaveBeenCalledWith("u/x.webm");
  });

  it("answers 404 for an unknown recording", async () => {
    prismaMock.feedback.findUnique.mockResolvedValue(null);
    expect((await call(server.base, `/api/admin/feedback/${FEEDBACK_ID}/audio`)).status).toBe(404);
  });
});

describe("POST /api/admin/feedback/:id/reprocess", () => {
  const reprocess = () => call(server.base, `/api/admin/feedback/${FEEDBACK_ID}/reprocess`, { method: "POST" });

  it("restarts a finished item with a new event id, because Inngest drops repeated ids", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.feedback.findUniqueOrThrow.mockResolvedValue(feedbackRow({ attempt: 2 }));

    const res = await reprocess();

    expect(res.status).toBe(202);
    const args = prismaMock.feedback.updateMany.mock.calls[0]![0];
    expect(args.where).toEqual({ id: FEEDBACK_ID, status: { in: ["FAILED", "COMPLETED"] } });
    expect(args.data).toEqual({ status: "UPLOADED", attempt: { increment: 1 }, errorCode: null, completedAt: null });
    expect(inngestMock.send).toHaveBeenCalledWith({
      id: `${FEEDBACK_ID}-2`,
      name: "feedback/uploaded",
      data: { feedbackId: FEEDBACK_ID },
    });
  });

  it("answers 409 for an item that is still processing", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.feedback.findUnique.mockResolvedValue({ id: FEEDBACK_ID });
    const res = await reprocess();
    expect(res.status).toBe(409);
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown item", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.feedback.findUnique.mockResolvedValue(null);
    expect((await reprocess()).status).toBe(404);
  });

  it("tells the admin when the queue is unreachable, instead of pretending it worked", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.feedback.findUniqueOrThrow.mockResolvedValue(feedbackRow({ attempt: 2 }));
    inngestMock.send.mockRejectedValue(new Error("down"));
    const res = await reprocess();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("QUEUE_UNAVAILABLE");
  });
});

describe("GET /api/admin/stats", () => {
  it("combines the counts into one summary", async () => {
    prismaMock.feedback.groupBy.mockResolvedValue([
      { status: "COMPLETED", _count: 5 },
      { status: "FAILED", _count: 1 },
    ]);
    prismaMock.sentimentAnalysis.groupBy.mockResolvedValue([{ label: "NEGATIVE", _count: 3 }]);
    prismaMock.transcription.groupBy.mockResolvedValue([
      { languageCode: "hi-IN", _count: 4 },
      { languageCode: null, _count: 1 },
    ]);
    prismaMock.sentimentAnalysis.count.mockResolvedValue(2);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ day: "2026-10-07", count: 6 }]).mockResolvedValueOnce([{ topic: "hygiene", count: 2 }]);

    const res = await call(server.base, "/api/admin/stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    expect(res.body.urgent).toBe(2);
    expect(res.body.byStatus).toEqual([
      { status: "COMPLETED", count: 5 },
      { status: "FAILED", count: 1 },
    ]);
    expect(res.body.bySentiment).toEqual([{ label: "NEGATIVE", count: 3 }]);
    expect(res.body.byLanguage).toEqual([
      { language: "hi-IN", count: 4 },
      { language: "unknown", count: 1 },
    ]);
    expect(res.body.volume).toEqual([{ day: "2026-10-07", count: 6 }]);
    expect(res.body.topics).toEqual([{ topic: "hygiene", count: 2 }]);
  });
});
