import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyseSentiment } from "../src/services/sentiment.service.js";
import { transcribe } from "../src/services/speech.service.js";
import { processFeedback } from "../src/inngest/process-feedback.js";
import { FEEDBACK_ID, feedbackRow } from "./helpers/fixtures.js";
import { prismaMock, storageMock } from "./helpers/mocks.js";

vi.mock("../src/services/speech.service.js", () => ({ transcribe: vi.fn() }));
vi.mock("../src/services/sentiment.service.js", () => ({ analyseSentiment: vi.fn() }));

// The Inngest function is a pair of options and a handler, so tests can run the handler directly
const fn = processFeedback as unknown as {
  options: {
    retries: number;
    throttle: { limit: number; period: string };
    onFailure: (ctx: { event: unknown; error: { message: string } }) => Promise<void>;
  };
  handler: (ctx: { event: unknown; step: unknown }) => Promise<unknown>;
};

// Runs each step immediately. Real Inngest also retries and remembers finished steps
const step = { run: async (_name: string, work: () => Promise<unknown>) => work() };
const event = { data: { feedbackId: FEEDBACK_ID } };
const run = () => fn.handler({ event, step });

const speech = {
  originalText: "खाना अच्छा नहीं था",
  englishText: "The food was not good",
  languageCode: "hi-IN",
  languageProb: 0.9,
  model: "saaras:v3",
};
const sentiment: Awaited<ReturnType<typeof analyseSentiment>> = { label: "NEGATIVE", score: -0.8, summary: "Unhappy with the food", topics: ["food quality"], urgent: false, model: "m", promptVersion: "v2" };

beforeEach(() => {
  prismaMock.feedback.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.feedback.findUniqueOrThrow.mockResolvedValue(feedbackRow({ status: "PROCESSING", languageHint: "hi-IN" }));
  prismaMock.transcription.findUnique.mockResolvedValue(null);
  prismaMock.transcription.create.mockResolvedValue({});
  prismaMock.sentimentAnalysis.upsert.mockReturnValue("upsert-op");
  prismaMock.feedback.update.mockReturnValue("update-op");
  prismaMock.$transaction.mockResolvedValue([]);
  storageMock.getObjectBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.mocked(transcribe).mockResolvedValue(speech);
  vi.mocked(analyseSentiment).mockResolvedValue(sentiment);
});

describe("process-feedback: the happy path", () => {
  it("transcribes, analyses and completes the feedback", async () => {
    const result = await run();

    expect(result).toEqual({ feedbackId: FEEDBACK_ID });
    expect(storageMock.getObjectBytes).toHaveBeenCalledWith(`customer-1/${FEEDBACK_ID}.webm`);
    // The language the customer picked is passed on to speech-to-text
    expect(transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/webm", "hi-IN");
    expect(prismaMock.transcription.create).toHaveBeenCalledWith({ data: { feedbackId: FEEDBACK_ID, ...speech } });
    // Sentiment is judged on the English text only
    expect(analyseSentiment).toHaveBeenCalledWith("The food was not good");
  });

  it("saves the analysis and marks the item COMPLETED in one transaction", async () => {
    await run();
    expect(prismaMock.$transaction).toHaveBeenCalledWith(["upsert-op", "update-op"]);
    expect(prismaMock.feedback.update).toHaveBeenCalledWith({
      where: { id: FEEDBACK_ID },
      data: { status: "COMPLETED", completedAt: expect.any(Date) },
    });
  });

  it("takes ownership of the item by moving it to PROCESSING", async () => {
    await run();
    expect(prismaMock.feedback.updateMany).toHaveBeenCalledWith({
      where: { id: FEEDBACK_ID, status: { in: ["UPLOADED", "PROCESSING"] } },
      data: { status: "PROCESSING", errorCode: null },
    });
  });
});

describe("process-feedback: duplicates and retries", () => {
  it("does nothing for a duplicate event whose item is not waiting to be processed", async () => {
    prismaMock.feedback.updateMany.mockResolvedValue({ count: 0 });
    expect(await run()).toEqual({ skipped: true });
    expect(transcribe).not.toHaveBeenCalled();
    expect(analyseSentiment).not.toHaveBeenCalled();
  });

  it("skips speech-to-text when a transcript already exists, so a reprocess does not pay for it twice", async () => {
    prismaMock.transcription.findUnique.mockResolvedValue({ englishText: "Saved earlier" });
    await run();
    expect(storageMock.getObjectBytes).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(prismaMock.transcription.create).not.toHaveBeenCalled();
    expect(analyseSentiment).toHaveBeenCalledWith("Saved earlier");
  });

  it("keeps the transcript when sentiment fails, and never marks the item COMPLETED", async () => {
    vi.mocked(analyseSentiment).mockRejectedValue(new NonRetriableError("ANALYSIS_INVALID"));
    await expect(run()).rejects.toThrow("ANALYSIS_INVALID");
    expect(prismaMock.transcription.create).toHaveBeenCalledOnce();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("stops before sentiment when speech-to-text fails", async () => {
    vi.mocked(transcribe).mockRejectedValue(new NonRetriableError("SPEECH_REJECTED"));
    await expect(run()).rejects.toThrow("SPEECH_REJECTED");
    expect(analyseSentiment).not.toHaveBeenCalled();
    expect(prismaMock.transcription.create).not.toHaveBeenCalled();
  });
});

describe("process-feedback: giving up", () => {
  const fail = (message: string) =>
    fn.options.onFailure({ event: { data: { event: { data: { feedbackId: FEEDBACK_ID } } } }, error: { message } });

  it.each(["NO_SPEECH", "SPEECH_REJECTED", "ANALYSIS_INVALID"])("records the %s code on the item and marks it FAILED", async (code) => {
    await fail(code);
    expect(prismaMock.feedback.update).toHaveBeenCalledWith({ where: { id: FEEDBACK_ID }, data: { status: "FAILED", errorCode: code } });
  });

  it("uses a generic code for failures it does not recognise, such as retries running out", async () => {
    await fail("SPEECH_UNAVAILABLE");
    expect(prismaMock.feedback.update).toHaveBeenCalledWith({
      where: { id: FEEDBACK_ID },
      data: { status: "FAILED", errorCode: "PROCESSING_FAILED" },
    });
  });
});

describe("process-feedback: configuration", () => {
  it("retries a failing step up to 3 times", () => {
    expect(fn.options.retries).toBe(3);
  });

  it("stays inside Sarvam's rate limit: 25 runs a minute, two calls each, against 60", () => {
    expect(fn.options.throttle).toEqual({ limit: 25, period: "1m" });
  });
});
