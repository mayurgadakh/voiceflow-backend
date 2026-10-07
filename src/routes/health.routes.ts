import { Router } from "express";
import { getLiveness, getReadiness } from "../controllers/health.controller.js";

export const healthRouter = Router();

healthRouter.get("/", getLiveness);
healthRouter.get("/ready", getReadiness);
