import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { transcribe } from "../src/services/speech.service.js";

const audio = new Uint8Array([1, 2, 3]);

function sarvamReply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // These tests exercise the real Sarvam client with fetch faked
  env.SARVAM_API_KEY = "test-key";
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe("transcribe", () => {
  it("makes two calls, one to transcribe and one to translate, and combines them", async () => {
    fetchSpy
      .mockResolvedValueOnce(sarvamReply({ transcript: "खाना अच्छा नहीं था", language_code: "hi-IN", language_probability: 0.93 }))
      .mockResolvedValueOnce(sarvamReply({ transcript: "The food was not good", language_code: "hi-IN" }));

    const result = await transcribe(audio, "audio/webm", null);

    expect(result).toEqual({
      originalText: "खाना अच्छा नहीं था",
      englishText: "The food was not good",
      languageCode: "hi-IN",
      languageProb: 0.93,
      model: "saaras:v3",
    });
    const modes = fetchSpy.mock.calls.map((call: [unknown, RequestInit]) => (call[1].body as FormData).get("mode"));
    expect(modes.sort()).toEqual(["transcribe", "translate"]);
  });

  it("authenticates with the API key header", async () => {
    fetchSpy.mockImplementation(async () => sarvamReply({ transcript: "hello", language_code: "en-IN" }));
    await transcribe(audio, "audio/webm", null);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).headers).toEqual({ "api-subscription-key": "test-key" });
  });

  it("auto-detects the language when the customer did not pick one", async () => {
    fetchSpy.mockImplementation(async () => sarvamReply({ transcript: "hello", language_code: "en-IN" }));
    await transcribe(audio, "audio/webm", null);
    const form = (fetchSpy.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(form.get("language_code")).toBe("unknown");
  });

  it("passes the language the customer picked", async () => {
    fetchSpy.mockImplementation(async () => sarvamReply({ transcript: "नमस्ते", language_code: "mr-IN" }));
    await transcribe(audio, "audio/webm", "mr-IN");
    const form = (fetchSpy.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(form.get("language_code")).toBe("mr-IN");
  });

  it("reports no confidence when Sarvam does not return one (a language was chosen)", async () => {
    fetchSpy.mockImplementation(async () => sarvamReply({ transcript: "hello", language_code: "en-IN" }));
    expect((await transcribe(audio, "audio/webm", "en-IN")).languageProb).toBeNull();
  });

  it("passes low language confidence through, for noisy or accented audio", async () => {
    fetchSpy.mockImplementation(async () => sarvamReply({ transcript: "mixed words", language_code: "hi-IN", language_probability: 0.41 }));
    expect((await transcribe(audio, "audio/webm", null)).languageProb).toBe(0.41);
  });

  describe("failures that must not be retried", () => {
    it.each([400, 403, 422])("Sarvam answering %s becomes SPEECH_REJECTED", async (status) => {
      fetchSpy.mockImplementation(async () => sarvamReply({ error: "no" }, status));
      const error = await transcribe(audio, "audio/webm", null).catch((e) => e);
      expect(error).toBeInstanceOf(NonRetriableError);
      expect(error.message).toBe("SPEECH_REJECTED");
    });

    it("a recording with no speech becomes NO_SPEECH", async () => {
      fetchSpy.mockImplementation(async () => sarvamReply({ transcript: "   ", language_code: null }));
      const error = await transcribe(audio, "audio/webm", null).catch((e) => e);
      expect(error).toBeInstanceOf(NonRetriableError);
      expect(error.message).toBe("NO_SPEECH");
    });
  });

  describe("failures that should be retried", () => {
    it("a 429 asks Inngest to retry after a pause", async () => {
      fetchSpy.mockImplementation(async () => sarvamReply({}, 429));
      const error = await transcribe(audio, "audio/webm", null).catch((e) => e);
      expect(error).toBeInstanceOf(RetryAfterError);
    });

    it.each([500, 502, 503])("a %s is an ordinary error, so Inngest retries with backoff", async (status) => {
      fetchSpy.mockImplementation(async () => sarvamReply({}, status));
      const error = await transcribe(audio, "audio/webm", null).catch((e) => e);
      expect(error).not.toBeInstanceOf(NonRetriableError);
      expect(error.message).toBe("SPEECH_UNAVAILABLE");
    });

    it("a network failure or timeout is retried", async () => {
      fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
      const error = await transcribe(audio, "audio/webm", null).catch((e) => e);
      expect(error).not.toBeInstanceOf(NonRetriableError);
      expect(error.message).toBe("SPEECH_UNAVAILABLE");
    });
  });

});
