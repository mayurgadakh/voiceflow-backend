import { Router } from "express";
import { ping } from "../controllers/admin.controller.js";
import { requireAdmin, requireUser } from "../middleware/auth.middleware.js";

export const adminRouter = Router();

adminRouter.use(requireUser, requireAdmin);
adminRouter.get("/ping", ping);
