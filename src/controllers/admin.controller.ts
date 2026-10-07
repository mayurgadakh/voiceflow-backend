import type { Request, Response } from "express";
import * as adminService from "../services/admin.service.js";
import { adminFeedbackQuerySchema } from "../validators/feedback.schema.js";

export function ping(_req: Request, res: Response) {
  res.json({ ok: true });
}

export async function listFeedback(req: Request, res: Response) {
  res.json(await adminService.listFeedback(adminFeedbackQuerySchema.parse(req.query)));
}

export async function getFeedback(req: Request<{ id: string }>, res: Response) {
  res.json(await adminService.getFeedback(req.params.id));
}

export async function getAudioUrl(req: Request<{ id: string }>, res: Response) {
  res.json(await adminService.getAudioUrl(req.params.id));
}

export async function reprocess(req: Request<{ id: string }>, res: Response) {
  res.status(202).json(await adminService.reprocess(req.params.id));
}

export async function getStats(_req: Request, res: Response) {
  res.json(await adminService.getStats());
}
