import { Router, type Router as ExpressRouter } from 'express';
import type { Env } from '../config/env.js';
import { createAuthMiddleware, type AuthRequest } from '../middleware/auth.js';
import { validateBody, validateQuery, type ValidatedRequest } from '../middleware/validate.js';
import type { MoviesListQuery, ShowtimesByDateQuery } from '@repo/shared';
import {
  createMovieRequestSchema,
  moviesListQuerySchema,
  showtimesByDateQuerySchema,
  updateMovieRequestSchema,
} from './schemas.js';
import { createMoviesService } from './service.js';
import { createShowtimesService } from '../showtimes/service.js';

function movieIdParam(id: string | string[] | undefined): string {
  if (typeof id === 'string') {
    return id;
  }
  if (Array.isArray(id) && id[0]) {
    return id[0];
  }
  return '';
}

/**
 * Mounts public and admin `/movies/*` HTTP endpoints.
 * Public routes: browse, search, detail. Admin routes: create, update, soft delete.
 */
export function createMoviesRouter(env: Env): ExpressRouter {
  const router = Router();
  const movies = createMoviesService();
  const showtimes = createShowtimesService();
  const { requireAuth, requireAdmin } = createAuthMiddleware(env);

  /** GET /movies — paginated catalog with optional genre, date, search, and sort filters. */
  router.get('/', validateQuery(moviesListQuerySchema), async (req, res, next) => {
    try {
      const query = (req as ValidatedRequest<MoviesListQuery>).validatedQuery;
      const result = await movies.listMovies({
        search: query.search,
        genreSlug: query.genre,
        date: query.date,
        page: query.page,
        limit: query.limit,
        sort: query.sort,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** GET /movies/:id/showtimes — public date-filtered showtime list. */
  router.get(
    '/:id/showtimes',
    validateQuery(showtimesByDateQuerySchema),
    async (req, res, next) => {
      try {
        const query = (req as ValidatedRequest<ShowtimesByDateQuery>).validatedQuery;
        const result = await showtimes.listShowtimesForMovie(movieIdParam(req.params.id), query.date);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** GET /movies/:id — single movie with genres and upcoming showtimes. */
  router.get('/:id', async (req, res, next) => {
    try {
      const result = await movies.getMovieById(movieIdParam(req.params.id));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** POST /movies — admin-only create with genre associations. */
  router.post(
    '/',
    requireAuth,
    requireAdmin,
    validateBody(createMovieRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const result = await movies.createMovie(req.body);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** PUT /movies/:id — admin-only partial update. */
  router.put(
    '/:id',
    requireAuth,
    requireAdmin,
    validateBody(updateMovieRequestSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const result = await movies.updateMovie(movieIdParam(req.params.id), req.body);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /** DELETE /movies/:id — admin-only soft delete (is_active = false). */
  router.delete(
    '/:id',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res, next) => {
      try {
        await movies.deleteMovie(movieIdParam(req.params.id));
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
