import { Router, type Router as ExpressRouter } from 'express';
import type pino from 'pino';
import { checkDatabaseHealth } from '../db/pools.js';
import { AppError } from '../errors/AppError.js';

export function createHealthRouter(logger: pino.Logger): ExpressRouter {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (req, res, next) => {
    try {
      const { primary, replicaCount } = await checkDatabaseHealth();
      const ready = primary && replicaCount >= 1;

      if (!ready) {
        logger.warn(
          { requestId: req.id, primary, replicaCount },
          'Readiness check failed',
        );
        return res.status(503).json({
          status: 'not_ready',
          checks: {
            primary,
            replicas: replicaCount,
          },
        });
      }

      res.json({
        status: 'ready',
        checks: {
          primary,
          replicas: replicaCount,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/debug/error', () => {
    throw new Error('Unhandled test error');
  });

  router.get('/debug/app-error', () => {
    throw new AppError('Bad request example', 400, 'BAD_REQUEST');
  });

  return router;
}
