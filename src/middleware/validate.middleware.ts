import type { RequestHandler } from "express";
import type { ZodType } from "zod";

// Parse failures throw a ZodError, which the error handler turns into a 400
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    schema.parse(req.params);
    next();
  };
}
