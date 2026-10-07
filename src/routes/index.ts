import { Router } from "express";
import { adminRouter } from "./admin.routes.js";
import { feedbackRouter } from "./feedback.routes.js";
import { userRouter } from "./user.routes.js";

export const apiRouter = Router();

apiRouter.use(userRouter);
apiRouter.use("/feedback", feedbackRouter);
apiRouter.use("/admin", adminRouter);
