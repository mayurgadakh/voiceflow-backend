import type { Request, Response } from "express";
import * as feedbackService from "../services/feedback.service.js";

export async function registerFeedback(req: Request, res: Response) {
  res.status(201).json(await feedbackService.registerFeedback(req.user!.id, req.body));
}

export async function completeUpload(req: Request<{ id: string }>, res: Response) {
  res.status(202).json(await feedbackService.completeUpload(req.user!.id, req.params.id));
}

export async function getFeedback(req: Request<{ id: string }>, res: Response) {
  res.json(await feedbackService.getFeedback(req.user!.id, req.params.id));
}

export async function listFeedback(req: Request, res: Response) {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  res.json(await feedbackService.listFeedback(req.user!.id, cursor));
}
