import { Router, type Router as ExpressRouter } from 'express';
import { createGenresService } from './service.js';

/**
 * Mounts public `/genres/*` HTTP endpoints.
 * Routes are thin: delegate to GenresService and shape HTTP responses.
 * No auth required — genres are read-only reference data.
 */
export function createGenresRouter(): ExpressRouter {
  const router = Router();
  const genres = createGenresService();

  /** GET /genres — list all seeded genres sorted by name. */
  router.get('/', async (_req, res, next) => {
    try {
      const result = await genres.listGenres();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
