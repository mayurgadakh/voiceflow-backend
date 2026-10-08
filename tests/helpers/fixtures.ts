export const FEEDBACK_ID = "6e90bde1-71a4-4961-848d-7652c10149c7";

export function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FEEDBACK_ID,
    userId: "customer-1",
    audioPath: `customer-1/${FEEDBACK_ID}.webm`,
    mimeType: "audio/webm",
    sizeBytes: 102692,
    durationMs: 14000,
    languageHint: null,
    status: "UPLOADING",
    attempt: 1,
    errorCode: null,
    consentAt: new Date("2026-10-07T12:00:00Z"),
    createdAt: new Date("2026-10-07T12:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

export const validRegisterBody = {
  mimeType: "audio/webm;codecs=opus",
  sizeBytes: 102692,
  durationMs: 14000,
  consent: true,
  languageHint: "hi-IN",
};
