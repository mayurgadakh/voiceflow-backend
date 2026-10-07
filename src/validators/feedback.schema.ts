import { z } from "zod";

export const MAX_DURATION_MS = 30_500;
export const MAX_SIZE_BYTES = 2 * 1024 * 1024;

export const AUDIO_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
} as const;

// Languages Sarvam speech-to-text accepts as language_code. Keep in sync with Frontend/src/lib/languages.ts
export const SPEECH_LANGUAGES = [
  "as-IN", "bn-IN", "brx-IN", "doi-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ks-IN", "kok-IN", "mai-IN", "ml-IN", "mni-IN", "mr-IN", "ne-IN", "od-IN", "pa-IN", "sa-IN", "sat-IN", "sd-IN", "ta-IN", "te-IN", "ur-IN",
] as const;

export const registerFeedbackSchema = z.object({
  // Browsers report e.g. "audio/webm;codecs=opus", so only the base type is checked
  mimeType: z
    .string()
    .transform((value) => value.split(";")[0]!.trim().toLowerCase())
    .pipe(z.enum(Object.keys(AUDIO_EXTENSIONS) as [keyof typeof AUDIO_EXTENSIONS, ...(keyof typeof AUDIO_EXTENSIONS)[]])),
  sizeBytes: z.number().int().min(1).max(MAX_SIZE_BYTES),
  durationMs: z.number().int().min(1).max(MAX_DURATION_MS),
  consent: z.literal(true),
  languageHint: z.enum(SPEECH_LANGUAGES).optional(),
});

export const feedbackIdSchema = z.object({ id: z.uuid() });

export const adminFeedbackQuerySchema = z.object({
  cursor: z.uuid().optional(),
  status: z.enum(["UPLOADING", "UPLOADED", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"]).optional(),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"]).optional(),
  language: z.enum([...SPEECH_LANGUAGES, "unknown"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
