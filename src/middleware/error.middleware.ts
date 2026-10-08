import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/app-error.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
    return;
  }
  // Client mistakes raised by Express itself, such as malformed JSON (400) or a body over the limit (413)
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const tooLarge = status === 413;
    res.status(status).json({
      error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
        message: tooLarge ? "Request body is too large" : "The request could not be read",
      },
    });
    return;
  }
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
};
