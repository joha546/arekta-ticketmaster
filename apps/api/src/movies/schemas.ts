import {
  createMovieRequestSchema,
  movieDetailResponseSchema,
  movieMutationResponseSchema,
  moviesListQuerySchema,
  moviesListResponseSchema,
  updateMovieRequestSchema,
} from '@repo/shared';

/**
 * Re-export shared movie schemas so route handlers import from one place.
 * Validation rules live in @repo/shared for reuse by the web app and API.
 */
export {
  createMovieRequestSchema,
  movieDetailResponseSchema,
  movieMutationResponseSchema,
  moviesListQuerySchema,
  moviesListResponseSchema,
  updateMovieRequestSchema,
};
