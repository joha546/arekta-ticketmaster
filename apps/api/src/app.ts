import cors from 'cors';
import express, { type Express } from 'express';
import type pino from 'pino';
import type { Env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { loggerMiddleware } from './middleware/logger.js';
import { requestId } from './middleware/requestId.js';
import { traceContext } from './middleware/traceContext.js';
import { createHealthRouter } from './routes/health.js';

export function createApp(env: Env, logger: pino.Logger): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());
  app.use(requestId());
  app.use(traceContext());
  app.use(loggerMiddleware(logger));

  app.use(createHealthRouter(logger));

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
