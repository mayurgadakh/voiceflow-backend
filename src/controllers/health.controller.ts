import type { Request, Response } from "express";
import { isDatabaseUp } from "../services/health.service.js";

export function getLiveness(_req: Request, res: Response) {
  res.json({ status: "ok" });
}

export async function getReadiness(_req: Request, res: Response) {
  const databaseUp = await isDatabaseUp();
  res.status(databaseUp ? 200 : 503).json({ status: databaseUp ? "ok" : "database down" });
}
