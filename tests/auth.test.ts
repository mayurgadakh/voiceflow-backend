import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/config/auth.js";
import { sendEmailMock } from "./helpers/mocks.js";

// The real auth configuration, running against an in-memory store instead of Postgres
type Row = Record<string, unknown>;
let store: { user: Row[]; session: Row[]; account: Row[]; verification: Row[] };
let auth: ReturnType<typeof createAuth>;

beforeEach(() => {
  store = { user: [], session: [], account: [], verification: [] };
  auth = createAuth(memoryAdapter(store));
});

const credentials = { name: "Priya", email: "priya@example.com", password: "a-long-enough-password" };

describe("signup", () => {
  it("creates a customer", async () => {
    await auth.api.signUpEmail({ body: credentials });
    expect(store.user).toHaveLength(1);
    expect(store.user[0]).toMatchObject({ email: "priya@example.com", role: "user", emailVerified: false });
  });

  it("cannot be used to become an admin: a request that asks for a role is refused and creates nothing", async () => {
    // A hand-made request carrying a role the signup form never sends
    await expect(auth.api.signUpEmail({ body: { ...credentials, role: "admin" } as never })).rejects.toThrow(/role is not allowed/i);
    expect(store.user).toHaveLength(0);
  });

  it("sends a verification email", async () => {
    await auth.api.signUpEmail({ body: credentials });
    expect(sendEmailMock).toHaveBeenCalledWith("priya@example.com", "Verify your email", expect.stringContaining("verify"));
  });

  it("does not store the password in plain text", async () => {
    await auth.api.signUpEmail({ body: credentials });
    const stored = JSON.stringify(store.account);
    expect(stored).not.toContain(credentials.password);
  });

  it("rejects a password that is too short", async () => {
    await expect(auth.api.signUpEmail({ body: { ...credentials, password: "short" } })).rejects.toMatchObject({ status: "BAD_REQUEST" });
    expect(store.user).toHaveLength(0);
  });
});

describe("login", () => {
  it("is refused until the email is verified", async () => {
    await auth.api.signUpEmail({ body: credentials });
    await expect(auth.api.signInEmail({ body: { email: credentials.email, password: credentials.password } })).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
    expect(store.session).toHaveLength(0);
  });

  it("works with the right password once verified", async () => {
    await auth.api.signUpEmail({ body: credentials });
    store.user[0]!.emailVerified = true;
    const result = await auth.api.signInEmail({ body: { email: credentials.email, password: credentials.password } });
    expect(result.user.email).toBe("priya@example.com");
    expect(store.session).toHaveLength(1);
  });

  it("is refused with a wrong password", async () => {
    await auth.api.signUpEmail({ body: credentials });
    store.user[0]!.emailVerified = true;
    await expect(auth.api.signInEmail({ body: { email: credentials.email, password: "wrong-password-here" } })).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
  });
});
