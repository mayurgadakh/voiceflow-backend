import { Resend } from "resend";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const resend = new Resend(env.RESEND_API_KEY);

// Errors are logged, not thrown, so a mail failure never crashes the process or slows the auth response
export async function sendEmail(to: string, subject: string, html: string) {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html });
  if (error) logger.error({ error }, "Failed to send email");
}
