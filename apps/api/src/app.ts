import cors from 'cors';
import express, { Router, type Express } from 'express';
import type pino from 'pino';
import { createAdminRouter } from './admin/routes.js';
import { createAuthRouter } from './auth/routes.js';
import type { Env } from './config/env.js';
import { createGenresRouter } from './genres/routes.js';
import { createMoviesRouter } from './movies/routes.js';
import { createPaymentsRouter } from './payments/routes.js';
import { createReservationsRouter } from './reservations/routes.js';
import { createSeatsRouter } from './seats/routes.js';
import { createShowtimesRouter } from './showtimes/routes.js';
import { createAuthMiddleware, type AuthRequest } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { loggerMiddleware } from './middleware/logger.js';
import { requestId } from './middleware/requestId.js';
import { traceContext } from './middleware/traceContext.js';
import { initRedis } from './redis/client.js';
import { createHealthRouter } from './routes/health.js';

export function createApp(env: Env, logger: pino.Logger): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());
  app.use(requestId());
  app.use(traceContext());
  app.use(loggerMiddleware(logger));

  initRedis(env);

  const { requireAuth, requireAdmin } = createAuthMiddleware(env);

  app.use(createHealthRouter(logger));

  app.use('/auth', createAuthRouter());
  app.use('/genres', createGenresRouter());
  app.use('/movies', createMoviesRouter());
  app.use('/showtimes', createShowtimesRouter());
  app.use('/seats', createSeatsRouter());
  app.use('/reservations', createReservationsRouter());
  app.use('/payments', createPaymentsRouter());
  app.use('/admin', createAdminRouter());

  if (env.NODE_ENV !== 'production') {
    const debugRouter = Router();
    debugRouter.get('/protected', requireAuth, (req: AuthRequest, res) => {
      res.json({ status: 'ok', userId: req.user?.id });
    });
    debugRouter.get('/admin', requireAuth, requireAdmin, (_req, res) => {
      res.json({ status: 'ok', role: 'admin' });
    });
    app.use('/debug', debugRouter);
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
