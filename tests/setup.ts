import { vi } from "vitest";

// Everything outside our own code is replaced here: the database, storage, the job queue,
// email and logging. Each test file then only configures what it needs

vi.mock("../src/config/logger.js", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

vi.mock("../src/config/prisma.js", async () => ({ prisma: (await import("./helpers/mocks.js")).prismaMock }));

vi.mock("../src/services/storage.service.js", async () => await import("./helpers/mocks.js").then((m) => m.storageMock));

vi.mock("../src/inngest/client.js", async () => ({ inngest: (await import("./helpers/mocks.js")).inngestMock }));

vi.mock("../src/services/email.service.js", async () => ({ sendEmail: (await import("./helpers/mocks.js")).sendEmailMock }));

// The Inngest HTTP endpoint is not under test, so it becomes a pass-through
vi.mock("inngest/express", () => ({ serve: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

// Keep the real createAuth (the auth tests use it) but swap the shared instance for a mock
vi.mock("../src/config/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/auth.js")>()),
  auth: (await import("./helpers/mocks.js")).authMock,
}));
