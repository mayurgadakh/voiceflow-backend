import { vi } from "vitest";

// The database is faked. Tests set what each call returns and check how the code called it
export const prismaMock = {
  feedback: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  },
  transcription: { findUnique: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
  sentimentAnalysis: { upsert: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
};

export const storageMock = {
  createUploadUrl: vi.fn(),
  getObjectSize: vi.fn(),
  getObjectBytes: vi.fn(),
  createPlaybackUrl: vi.fn(),
  deleteObjects: vi.fn(),
};

export const inngestMock = {
  send: vi.fn(),
  // Returns the pieces so a test can run the function's handler directly
  createFunction: vi.fn((options: unknown, handler: unknown) => ({ options, handler })),
};

export const authMock = {
  api: { getSession: vi.fn() },
  handler: vi.fn(),
};

export const sendEmailMock = vi.fn();
