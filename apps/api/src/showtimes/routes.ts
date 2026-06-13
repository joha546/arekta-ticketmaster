import { Router, type Router as ExpressRouter } from 'express';

export function createShowtimesRouter(): ExpressRouter {
  const router = Router();
  router.use((_req, res) => {
    res.status(501).json({
      error: { code: 'NOT_IMPLEMENTED', message: 'Showtimes module not implemented yet' },
    });
  });
  return router;
}
