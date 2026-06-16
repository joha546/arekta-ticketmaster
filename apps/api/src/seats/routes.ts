import { Router, type Router as ExpressRouter } from 'express';
import type { Env } from '../config/env.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { holdSeatsRequestSchema, releaseHoldRequestSchema } from './schemas.js';
import { createSeatsService } from './service.js';

function holdTokenParam(token: string | string[] | undefined): string {
  if (typeof token === 'string') {
    return token;
  }
  if (Array.isArray(token) && token[0]) {
    return token[0];
  }
  return '';
}

/**
 * Mounts `/seats/*` hold endpoints.
 * Seat map is exposed at `GET /showtimes/:id/seats` via showtimes router.
 */
export function createSeatsRouter(env: Env): ExpressRouter {
  const router = Router();
  const seats = createSeatsService(env);
  const { requireAuth, requireVerifiedEmail } = createAuthMiddleware(env);

  /** POST /seats/hold — atomic batch hold for verified users. */
  router.post(
    '/hold',
    requireAuth,
    requireVerifiedEmail,
    validateBody(holdSeatsRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const result = await seats.holdSeats(req.user!.id, req.body);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** GET /seats/hold/:holdToken — active hold status for the owner. */
  router.get('/hold/:holdToken', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await seats.getHoldStatus(
        req.user!.id,
        holdTokenParam(req.params.holdToken),
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** DELETE /seats/hold — manual release by hold owner. */
  router.delete(
    '/hold',
    requireAuth,
    validateBody(releaseHoldRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        await seats.releaseHold(req.user!.id, req.body.holdToken);
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/** Registers public seat map route on the showtimes router. */
export function registerSeatMapRoute(router: ExpressRouter, env: Env): void {
  const seats = createSeatsService(env);

  router.get('/:id/seats', async (req, res, next) => {
    try {
      const showtimeId =
        typeof req.params.id === 'string'
          ? req.params.id
          : Array.isArray(req.params.id)
            ? (req.params.id[0] ?? '')
            : '';
      const result = await seats.getSeatMap(showtimeId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
}
