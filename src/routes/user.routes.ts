import { Router } from "express";
import { getMe } from "../controllers/user.controller.js";
import { requireUser } from "../middleware/auth.middleware.js";

export const userRouter = Router();

userRouter.get("/me", requireUser, getMe);
