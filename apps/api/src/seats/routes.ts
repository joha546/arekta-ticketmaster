import { Router, type Router as ExpressRouter } from 'express';

export function createSeatsRouter(): ExpressRouter {
  const router = Router();
  router.use((_req, res) => {
    res.status(501).json({
      error: { code: 'NOT_IMPLEMENTED', message: 'Seats module not implemented yet' },
    });
  });
  return router;
}
