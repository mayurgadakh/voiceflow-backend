import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CLIENT_URL: z.url(),
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().min(1),
    // Any S3-compatible store: AWS S3, Supabase Storage, Cloudflare R2, MinIO (local Docker)
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    SARVAM_API_KEY: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    SENTIMENT_MODEL: z.string().min(1).default("openai/gpt-4o-mini"),
    // Use fixtures instead of calling Sarvam and the LLM
    MOCK_SPEECH: z.stringbool().default(false),
    // Production only. The local Inngest dev server needs neither
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  })
  .refine((e) => e.MOCK_SPEECH || (e.SARVAM_API_KEY && e.OPENROUTER_API_KEY), {
    message: "SARVAM_API_KEY and OPENROUTER_API_KEY are required unless MOCK_SPEECH=true",
  });

export const env = envSchema.parse(process.env);
