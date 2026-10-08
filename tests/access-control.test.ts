import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, CUSTOMER, call, loginAs, startServer } from "./helpers/http.js";
import { FEEDBACK_ID } from "./helpers/fixtures.js";
import { prismaMock } from "./helpers/mocks.js";

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

describe("anonymous visitors", () => {
  beforeEach(() => loginAs(null));

  it.each([
    ["GET", "/api/me"],
    ["GET", "/api/feedback"],
    ["POST", "/api/feedback"],
    ["GET", `/api/feedback/${FEEDBACK_ID}`],
    ["POST", `/api/feedback/${FEEDBACK_ID}/complete`],
    ["GET", "/api/admin/stats"],
    ["GET", "/api/admin/feedback"],
    ["GET", `/api/admin/feedback/${FEEDBACK_ID}`],
    ["GET", `/api/admin/feedback/${FEEDBACK_ID}/audio`],
    ["POST", `/api/admin/feedback/${FEEDBACK_ID}/reprocess`],
  ])("get 401 on %s %s", async (method, path) => {
    const res = await call(server.base, path, { method });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Please log in" } });
  });

  it("can reach the public health endpoints", async () => {
    expect((await call(server.base, "/health")).status).toBe(200);
  });
});

describe("customers", () => {
  beforeEach(() => loginAs(CUSTOMER));

  it("can read their own profile", async () => {
    const res = await call(server.base, "/api/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: CUSTOMER.id, role: "user" });
  });

  it.each([
    ["GET", "/api/admin/ping"],
    ["GET", "/api/admin/stats"],
    ["GET", "/api/admin/feedback"],
    ["GET", `/api/admin/feedback/${FEEDBACK_ID}`],
    ["GET", `/api/admin/feedback/${FEEDBACK_ID}/audio`],
    ["POST", `/api/admin/feedback/${FEEDBACK_ID}/reprocess`],
  ])("get 403 on admin route %s %s", async (method, path) => {
    const res = await call(server.base, path, { method });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("never reaches the database on an admin route", async () => {
    await call(server.base, "/api/admin/feedback");
    expect(prismaMock.feedback.findMany).not.toHaveBeenCalled();
  });
});

describe("admins", () => {
  beforeEach(() => loginAs(ADMIN));

  it("can use admin routes", async () => {
    const res = await call(server.base, "/api/admin/ping");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it.each([
    ["GET", "/api/feedback"],
    ["POST", "/api/feedback"],
    ["GET", `/api/feedback/${FEEDBACK_ID}`],
    ["POST", `/api/feedback/${FEEDBACK_ID}/complete`],
  ])("cannot submit or read customer feedback: %s %s", async (method, path) => {
    const res = await call(server.base, path, { method, body: method === "POST" ? {} : undefined });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Admins cannot submit feedback");
  });
});

describe("unknown routes and bad requests", () => {
  beforeEach(() => loginAs(CUSTOMER));

  it("answer unknown routes with a JSON 404", async () => {
    const res = await call(server.base, "/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("answer malformed JSON with a 400, not a crash", async () => {
    const res = await call(server.base, "/api/feedback", { method: "POST", rawBody: "{not json" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("answer an oversized body with 413", async () => {
    const res = await call(server.base, "/api/feedback", { method: "POST", body: { notes: "x".repeat(200_000) } });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
