import type { AddressInfo } from "node:net";
import { authMock } from "./mocks.js";

/** Starts the real Express app on a random free port, so tests make real HTTP requests with fetch. */
export async function startServer() {
  const { app } = await import("../../src/app.js");
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

export async function call(base: string, path: string, init?: { method?: string; body?: unknown; rawBody?: string }) {
  const body = init?.rawBody ?? (init?.body === undefined ? undefined : JSON.stringify(init.body));
  const res = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export const CUSTOMER = { id: "customer-1", name: "Priya Sharma", email: "priya@example.com", role: "user" };
export const ADMIN = { id: "admin-1", name: "Mayur", email: "admin@example.com", role: "admin" };

export function loginAs(user: typeof CUSTOMER | null) {
  authMock.api.getSession.mockResolvedValue(user ? { session: { id: "s1" }, user } : null);
}
