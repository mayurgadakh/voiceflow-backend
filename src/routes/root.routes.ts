import { Router } from "express";
import { ping } from "../controllers/root.controller.js";


export const rootRouter = Router();

rootRouter.get("/", ping);
