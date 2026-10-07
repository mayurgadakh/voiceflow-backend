import { Router } from "express";
import * as feedback from "../controllers/feedback.controller.js";
import { requireCustomer, requireUser } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validate.middleware.js";
import { feedbackIdSchema, registerFeedbackSchema } from "../validators/feedback.schema.js";

export const feedbackRouter = Router();

feedbackRouter.use(requireUser, requireCustomer);
feedbackRouter.post("/", validateBody(registerFeedbackSchema), feedback.registerFeedback);
feedbackRouter.get("/", feedback.listFeedback);
feedbackRouter.get("/:id", validateParams(feedbackIdSchema), feedback.getFeedback);
feedbackRouter.post("/:id/complete", validateParams(feedbackIdSchema), feedback.completeUpload);
