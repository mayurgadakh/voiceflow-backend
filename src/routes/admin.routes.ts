import { Router } from "express";
import * as admin from "../controllers/admin.controller.js";
import { requireAdmin, requireUser } from "../middleware/auth.middleware.js";
import { validateParams } from "../middleware/validate.middleware.js";
import { feedbackIdSchema } from "../validators/feedback.schema.js";

export const adminRouter = Router();

adminRouter.use(requireUser, requireAdmin);
adminRouter.get("/ping", admin.ping);
adminRouter.get("/stats", admin.getStats);
adminRouter.get("/feedback", admin.listFeedback);
adminRouter.get("/feedback/:id", validateParams(feedbackIdSchema), admin.getFeedback);
adminRouter.get("/feedback/:id/audio", validateParams(feedbackIdSchema), admin.getAudioUrl);
adminRouter.post("/feedback/:id/reprocess", validateParams(feedbackIdSchema), admin.reprocess);
