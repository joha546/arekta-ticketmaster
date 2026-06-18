import { Router, type Router as ExpressRouter } from 'express';
import type { IdempotencyKey, ReservationListQuery } from '@repo/shared';
import type { Env } from '../config/env.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import {
  validateBody,
  validateHeader,
  validateQuery,
  type ValidatedHeadersRequest,
  type ValidatedRequest,
} from '../middleware/validate.js';
import {
  createReservationRequestSchema,
  idempotencyKeySchema,
  paymentStatusResponseSchema,
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

type CreateReservationBody = { holdToken: string };

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
    validateHeader('X-Idempotency-Key', idempotencyKeySchema),
    validateBody(createReservationRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const idempotencyKey = (req as ValidatedHeadersRequest<IdempotencyKey>).validatedHeaders;
        const body = req.body as CreateReservationBody;
        const result = await reservations.createReservation(req.user!.id, {
          holdToken: body.holdToken,
          idempotencyKey,
        });

        if (result.replayed) {
          res.set('Idempotent-Replayed', 'true');
        }

        res.status(201).json({
          reservation: result.reservation,
          paymentUrl: result.paymentUrl,
        });
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

  /** GET /reservations/:id/payment-status — reservation + payment status (primary read). */
  router.get('/:id/payment-status', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const result = await reservations.getPaymentStatus(
        req.user!,
        reservationIdParam(req.params.id),
      );
      res.json(paymentStatusResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

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
