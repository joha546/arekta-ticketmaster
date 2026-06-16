import { Router, type Router as ExpressRouter } from 'express';
import type { ReservationListQuery } from '@repo/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { validateBody, validateQuery, type ValidatedRequest } from '../middleware/validate.js';
import {
  createReservationRequestSchema,
  reservationListQuerySchema,
} from './schemas.js';
import { createReservationsService } from './service.js';

function reservationIdParam(id: string | string[] | undefined): string {
  if (typeof id === 'string') {
    return id;
  }
  if (Array.isArray(id) && id[0]) {
    return id[0];
  }
  return '';
}

function idempotencyKeyHeader(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value) && value[0]?.trim()) {
    return value[0].trim();
  }
  return null;
}

/**
 * Mounts `/reservations/*` HTTP endpoints.
 */
export function createReservationsRouter(env: Env): ExpressRouter {
  const router = Router();
  const reservations = createReservationsService(env);
  const { requireAuth, requireVerifiedEmail } = createAuthMiddleware(env);

  /** POST /reservations — create pending reservation from an active hold. */
  router.post(
    '/',
    requireAuth,
    requireVerifiedEmail,
    validateBody(createReservationRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const idempotencyKey = idempotencyKeyHeader(req.headers['x-idempotency-key']);
        if (!idempotencyKey) {
          throw new AppError('X-Idempotency-Key header is required', 400, 'VALIDATION_ERROR');
        }

        const result = await reservations.createReservation(req.user!.id, {
          holdToken: req.body.holdToken,
          idempotencyKey,
        });
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** GET /reservations — list own reservations; admin can filter all. */
  router.get(
    '/',
    requireAuth,
    validateQuery(reservationListQuerySchema),
    async (req: AuthRequest, res, next) => {
      try {
        const query = (req as ValidatedRequest<ReservationListQuery>).validatedQuery;
        const result = await reservations.listReservations(req.user!, {
          status: query.status,
          from: query.from,
          to: query.to,
          userId: query.userId,
          movieId: query.movieId,
          page: query.page,
          limit: query.limit,
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** GET /reservations/:id — reservation detail with seat labels. */
  router.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await reservations.getReservation(
        req.user!,
        reservationIdParam(req.params.id),
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** DELETE /reservations/:id — cancel upcoming pending/confirmed reservation. */
  router.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await reservations.cancelReservation(
        req.user!.id,
        reservationIdParam(req.params.id),
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
