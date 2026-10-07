import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { sendEmail } from "../services/email.service.js";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CLIENT_URL],
  // Keeps the serverless function alive until background work (like sending emails) finishes
  advanced: { backgroundTasks: { handler: waitUntil } },
  database: prismaAdapter(prisma, { provider: "postgresql" }),
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
