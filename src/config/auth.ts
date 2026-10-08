import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { sendEmail } from "../services/email.service.js";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

type Database = Parameters<typeof betterAuth>[0]["database"];

// A factory so tests can run the real auth configuration against an in-memory store
export function createAuth(database: Database) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.CLIENT_URL],
    // Keeps the serverless function alive until background work (like sending emails) finishes
    advanced: { backgroundTasks: { handler: waitUntil } },
    database,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        return sendEmail(
          user.email,
          "Reset your password",
          `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        return sendEmail(
          user.email,
          "Verify your email",
          `<p>Click <a href="${url}">here</a> to verify your email.</p>`,
        );
      },
    },
    plugins: [admin({ defaultRole: "user" })],
  });
}

export const auth = createAuth(prismaAdapter(prisma, { provider: "postgresql" }));
