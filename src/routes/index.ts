import { Router } from "express";
import { adminRouter } from "./admin.routes.js";
import { userRouter } from "./user.routes.js";

export const apiRouter = Router();

apiRouter.use(userRouter);
apiRouter.use("/admin", adminRouter);
