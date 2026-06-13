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

  router.get('/events', async (_req, res, next) => {
    try {
      const { queryRead } = await import('../db/pools.js');
      const result = await queryRead<{ id: number; name: string; venue: string }>(
        'SELECT id, name, venue FROM events ORDER BY id DESC LIMIT 10',
      );
      res.json({ events: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.post('/events', async (req, res, next) => {
    try {
      const { name, venue } = req.body as { name?: string; venue?: string };
      if (!name || !venue) {
        throw new AppError('name and venue are required', 400, 'VALIDATION_ERROR');
      }

      const { queryWrite } = await import('../db/pools.js');
      const result = await queryWrite<{ id: number; name: string; venue: string }>(
        'INSERT INTO events (name, venue) VALUES ($1, $2) RETURNING id, name, venue',
        [name, venue],
      );

      res.status(201).json({ event: result.rows[0] });
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
