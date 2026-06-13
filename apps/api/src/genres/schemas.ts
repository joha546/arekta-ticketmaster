import { genreSchema, genresResponseSchema } from '@repo/shared';

/**
 * Re-export shared genre schemas so route handlers import from one place.
 * Validation rules live in @repo/shared for reuse by the web app and API.
 */
export { genreSchema, genresResponseSchema };
