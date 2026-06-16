import { Router, type Router as ExpressRouter } from 'express';
import type { Env } from '../config/env.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createShowtimeRequestSchema, updateShowtimeRequestSchema } from './schemas.js';
import { createShowtimesService } from './service.js';
import { registerSeatMapRoute } from '../seats/routes.js';

function showtimeIdParam(id: string | string[] | undefined): string {
  if (typeof id === 'string') {
    return id;
  }
  if (Array.isArray(id) && id[0]) {
    return id[0];
  }
  return '';
}

/**
 * Mounts admin `/showtimes/*` HTTP endpoints.
 * Public listing lives under `/movies/:id/showtimes` in the movies router.
 */
export function createShowtimesRouter(env: Env): ExpressRouter {
  const router = Router();
  const showtimes = createShowtimesService();
  const { requireAuth, requireAdmin } = createAuthMiddleware(env);

  registerSeatMapRoute(router, env);

  /** POST /showtimes — admin-only create with implicit screen_id=1. */
  router.post(
    '/',
    requireAuth,
    requireAdmin,
    validateBody(createShowtimeRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const result = await showtimes.createShowtime(req.body);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** PUT /showtimes/:id — admin-only partial update when no confirmed reservations. */
  router.put(
    '/:id',
    requireAuth,
    requireAdmin,
    validateBody(updateShowtimeRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const result = await showtimes.updateShowtime(showtimeIdParam(req.params.id), req.body);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** POST /showtimes/:id/cancel — admin-only soft cancel. */
  router.post(
    '/:id/cancel',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res, next) => {
      try {
        const result = await showtimes.cancelShowtime(showtimeIdParam(req.params.id));
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
