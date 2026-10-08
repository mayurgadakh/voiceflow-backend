import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Resets call history and any implementation a test set, so tests cannot affect each other
    mockReset: true,
    env: {
      NODE_ENV: "test",
      // Never read the developer's real .env while testing
      DOTENV_CONFIG_PATH: "/nonexistent",
      DOTENV_CONFIG_QUIET: "true",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
      BETTER_AUTH_URL: "http://localhost:5173",
      CLIENT_URL: "http://localhost:5173",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Voiceflow <test@example.com>",
      S3_BUCKET: "test-bucket",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      SARVAM_API_KEY: "test-sarvam-key",
      OPENROUTER_API_KEY: "test-openrouter-key",
    },
  },
});
