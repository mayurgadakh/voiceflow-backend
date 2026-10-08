import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FEEDBACK_ID, feedbackRow, validRegisterBody } from "./helpers/fixtures.js";
import { CUSTOMER, call, loginAs, startServer } from "./helpers/http.js";
import { inngestMock, prismaMock, storageMock } from "./helpers/mocks.js";

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());
beforeEach(() => {
  loginAs(CUSTOMER);
  storageMock.createUploadUrl.mockResolvedValue("https://storage.test/upload?signed=1");
});

describe("POST /api/feedback (register a recording)", () => {
  it("creates an UPLOADING row and returns a signed upload URL", async () => {
    prismaMock.feedback.create.mockResolvedValue({});
    const res = await call(server.base, "/api/feedback", { method: "POST", body: validRegisterBody });

    expect(res.status).toBe(201);
    expect(res.body.uploadUrl).toBe("https://storage.test/upload?signed=1");
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const { data } = prismaMock.feedback.create.mock.calls[0]![0];
    expect(data).toMatchObject({ userId: CUSTOMER.id, sizeBytes: 102692, durationMs: 14000, languageHint: "hi-IN" });
    expect(data.consentAt).toBeInstanceOf(Date);
    // The default status (UPLOADING) comes from the schema, so the code must not set another one
    expect(data.status).toBeUndefined();
  });

  it("builds the storage path on the server, inside the user's own folder", async () => {
    prismaMock.feedback.create.mockResolvedValue({});
    const res = await call(server.base, "/api/feedback", { method: "POST", body: validRegisterBody });
    const { data } = prismaMock.feedback.create.mock.calls[0]![0];
    expect(data.audioPath).toBe(`${CUSTOMER.id}/${res.body.id}.webm`);
  });

  it("strips codec parameters from the MIME type before signing and saving", async () => {
    prismaMock.feedback.create.mockResolvedValue({});
    await call(server.base, "/api/feedback", { method: "POST", body: validRegisterBody });
    expect(prismaMock.feedback.create.mock.calls[0]![0].data.mimeType).toBe("audio/webm");
    expect(storageMock.createUploadUrl).toHaveBeenCalledWith(expect.stringMatching(/\.webm$/), "audio/webm", 102692);
  });

  it.each([
    ["audio/webm", "webm"],
    ["audio/mp4", "mp4"],
    ["audio/ogg", "ogg"],
  ])("accepts %s and stores it as .%s", async (mimeType, extension) => {
    prismaMock.feedback.create.mockResolvedValue({});
    const res = await call(server.base, "/api/feedback", { method: "POST", body: { ...validRegisterBody, mimeType } });
    expect(res.status).toBe(201);
    expect(prismaMock.feedback.create.mock.calls[0]![0].data.audioPath).toMatch(new RegExp(`\\.${extension}$`));
  });

  describe("rejects bad input with 400 and writes nothing", () => {
    it.each([
      ["a file type we do not accept", { mimeType: "audio/mpeg" }],
      ["a video file", { mimeType: "video/mp4" }],
      ["an excessively long recording (over 30.5 s)", { durationMs: 30_501 }],
      ["a recording of zero length", { durationMs: 0 }],
      ["an oversize file (over 2 MB)", { sizeBytes: 2 * 1024 * 1024 + 1 }],
      ["an empty file", { sizeBytes: 0 }],
      ["a fractional size", { sizeBytes: 100.5 }],
      ["no consent", { consent: false }],
      ["a language Sarvam does not support", { languageHint: "xx-YY" }],
      ["a duration sent as text", { durationMs: "14000" }],
    ])("%s", async (_name, override) => {
      const res = await call(server.base, "/api/feedback", { method: "POST", body: { ...validRegisterBody, ...override } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(prismaMock.feedback.create).not.toHaveBeenCalled();
      expect(storageMock.createUploadUrl).not.toHaveBeenCalled();
    });

    it("a missing consent field", async () => {
      const { consent: _consent, ...withoutConsent } = validRegisterBody;
      const res = await call(server.base, "/api/feedback", { method: "POST", body: withoutConsent });
      expect(res.status).toBe(400);
    });
  });

  it("accepts the exact limits: 30.5 s and 2 MB", async () => {
    prismaMock.feedback.create.mockResolvedValue({});
    const res = await call(server.base, "/api/feedback", {
      method: "POST",
      body: { ...validRegisterBody, durationMs: 30_500, sizeBytes: 2 * 1024 * 1024 },
    });
    expect(res.status).toBe(201);
  });

  it("accepts every language Sarvam lists, and no language at all (auto-detect)", async () => {
    prismaMock.feedback.create.mockResolvedValue({});
    for (const languageHint of ["en-IN", "hi-IN", "mr-IN", "ta-IN", "kok-IN", "mni-IN"]) {
      const res = await call(server.base, "/api/feedback", { method: "POST", body: { ...validRegisterBody, languageHint } });
      expect(res.status).toBe(201);
    }
    const { languageHint: _hint, ...auto } = validRegisterBody;
    expect((await call(server.base, "/api/feedback", { method: "POST", body: auto })).status).toBe(201);
  });
});

describe("POST /api/feedback/:id/complete (confirm the upload)", () => {
  const complete = () => call(server.base, `/api/feedback/${FEEDBACK_ID}/complete`, { method: "POST" });

  it("moves the row to UPLOADED and queues processing", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(feedbackRow());
    storageMock.getObjectSize.mockResolvedValue(102692);
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 1 });

    const res = await complete();

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "UPLOADED" });
    // Conditional update: only a row that is still UPLOADING can be moved
    expect(prismaMock.feedback.updateMany).toHaveBeenCalledWith({
      where: { id: FEEDBACK_ID, status: "UPLOADING" },
      data: { status: "UPLOADED" },
    });
    // The event id includes the attempt, which is what makes a retried confirm a no-op in Inngest
    expect(inngestMock.send).toHaveBeenCalledWith({
      id: `${FEEDBACK_ID}-1`,
      name: "feedback/uploaded",
      data: { feedbackId: FEEDBACK_ID },
    });
  });

  it("only looks up recordings that belong to the logged-in user", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(null);
    await complete();
    expect(prismaMock.feedback.findFirst).toHaveBeenCalledWith({ where: { id: FEEDBACK_ID, userId: CUSTOMER.id } });
  });

  it("answers 404 for a recording that is missing or belongs to someone else", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(null);
    const res = await complete();
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("answers 409 when confirmed twice, and does not queue a second job", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(feedbackRow({ status: "UPLOADED" }));
    const res = await complete();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE");
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("answers 409 when two confirms race and the other one wins", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(feedbackRow());
    storageMock.getObjectSize.mockResolvedValue(102692);
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 0 });
    const res = await complete();
    expect(res.status).toBe(409);
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("answers 400 when the file never reached storage", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(feedbackRow());
    storageMock.getObjectSize.mockResolvedValue(null);
    const res = await complete();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UPLOAD_MISSING");
    expect(prismaMock.feedback.updateMany).not.toHaveBeenCalled();
  });

  it("answers 400 when the stored file is not the size that was declared", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(feedbackRow());
    storageMock.getObjectSize.mockResolvedValue(5);
    const res = await complete();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UPLOAD_MISSING");
  });

  it("still succeeds if the job queue is down, leaving the row UPLOADED for recovery", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(feedbackRow());
    storageMock.getObjectSize.mockResolvedValue(102692);
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 1 });
    inngestMock.send.mockRejectedValue(new Error("queue unreachable"));
    const res = await complete();
    expect(res.status).toBe(202);
  });

  it("rejects an id that is not a UUID before touching the database", async () => {
    const res = await call(server.base, "/api/feedback/not-a-uuid/complete", { method: "POST" });
    expect(res.status).toBe(400);
    expect(prismaMock.feedback.findFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/feedback/:id", () => {
  it("is scoped to the logged-in user, so other people's recordings are 404", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue(null);
    const res = await call(server.base, `/api/feedback/${FEEDBACK_ID}`);
    expect(res.status).toBe(404);
    expect(prismaMock.feedback.findFirst.mock.calls[0]![0].where).toEqual({ id: FEEDBACK_ID, userId: CUSTOMER.id });
  });

  it("never asks the database for sentiment, which is for admins only", async () => {
    prismaMock.feedback.findFirst.mockResolvedValue({ id: FEEDBACK_ID, status: "COMPLETED" });
    await call(server.base, `/api/feedback/${FEEDBACK_ID}`);
    const { select } = prismaMock.feedback.findFirst.mock.calls[0]![0];
    expect(select.transcription).toBeDefined();
    expect(select.analysis).toBeUndefined();
    expect(select.audioPath).toBeUndefined();
  });
});

describe("GET /api/feedback (list)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

  it("returns a page of 20 and a cursor when there is more", async () => {
    prismaMock.feedback.findMany.mockResolvedValue(rows(21));
    const res = await call(server.base, "/api/feedback");
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBe("id-19");
  });

  it("returns no cursor on the last page", async () => {
    prismaMock.feedback.findMany.mockResolvedValue(rows(3));
    const res = await call(server.base, "/api/feedback");
    expect(res.body.items).toHaveLength(3);
    expect(res.body.nextCursor).toBeNull();
  });

  it("only lists the user's own recordings, and continues from the cursor", async () => {
    prismaMock.feedback.findMany.mockResolvedValue([]);
    await call(server.base, "/api/feedback?cursor=id-19");
    expect(prismaMock.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: CUSTOMER.id }, cursor: { id: "id-19" }, skip: 1 }),
    );
  });
});
