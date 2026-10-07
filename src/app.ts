import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./config/auth.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFound } from "./middleware/error.middleware.js";
import { apiRouter } from "./routes/index.js";
import { healthRouter } from "./routes/health.routes.js";
import { rootRouter } from "./routes/root.routes.js";

export const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customSuccessMessage: (req, res, time) => `${req.method} ${req.originalUrl} ${res.statusCode} ${time}ms`,
  }),
);

// Better Auth reads the raw request body, so it must come before express.json()
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());
app.use("/health", healthRouter);
app.use("/api", apiRouter);
app.use("/", rootRouter)

app.use(notFound);
app.use(errorHandler);

// Vercel uses this module as the serverless entrypoint and requires a default export
export default app;
