import { NonRetriableError, RetryAfterError } from "inngest";
import { env } from "../config/env.js";

const SARVAM_URL = "https://api.sarvam.ai/speech-to-text";
const TIMEOUT_MS = 20_000;

const MODEL = "saaras:v4";

export type Speech = {
  originalText: string;
  englishText: string;
  languageCode: string | null;
  languageProb: number | null;
  model: string;
};

type SarvamResponse = { transcript: string; language_code: string | null; language_probability?: number | null };

async function callSarvam(audio: Uint8Array, mimeType: string, mode: "transcribe" | "translate", language: string) {
  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart], { type: mimeType }), `audio.${mimeType.split("/")[1]}`);
  form.append("model", MODEL);
  form.append("mode", mode);
  form.append("language_code", language);

  let res: Response;
  try {
    res = await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "api-subscription-key": env.SARVAM_API_KEY },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("SPEECH_UNAVAILABLE"); // network error or timeout: retry
  }

  if (res.ok) return (await res.json()) as SarvamResponse;
  // Bad request, bad key and unprocessable audio will never succeed on retry
  if ([400, 403, 422].includes(res.status)) throw new NonRetriableError("SPEECH_REJECTED");
  if (res.status === 429) throw new RetryAfterError("SPEECH_RATE_LIMITED", "30s");
  throw new Error("SPEECH_UNAVAILABLE");
}

/** Transcribes in the original language and translates to English, in parallel. */
export async function transcribe(audio: Uint8Array, mimeType: string, languageHint: string | null): Promise<Speech> {
  const language = languageHint ?? "unknown";
  const [original, english] = await Promise.all([
    callSarvam(audio, mimeType, "transcribe", language),
    callSarvam(audio, mimeType, "translate", language),
  ]);

  if (!original.transcript.trim() || !english.transcript.trim()) throw new NonRetriableError("NO_SPEECH");
  return {
    originalText: original.transcript,
    englishText: english.transcript,
    languageCode: original.language_code,
    languageProb: original.language_probability ?? null,
    model: MODEL,
  };
}
