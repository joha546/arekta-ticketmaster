import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    primary: z.boolean(),
    replicas: z.number(),
  }),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  });
}

export const userRoleSchema = z.enum(['admin', 'user']);

export type UserRole = z.infer<typeof userRoleSchema>;

/** Public user object returned by auth endpoints. */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: userRoleSchema,
  emailVerified: z.boolean(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const signupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(255),
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const googleAuthRequestSchema = z.object({
  idToken: z.string().min(1),
});

export type GoogleAuthRequest = z.infer<typeof googleAuthRequestSchema>;

/** Single genre reference row (seed data — read-only in Phase 1). */
export const genreSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
});

export type Genre = z.infer<typeof genreSchema>;

/** Response shape for GET /genres. */
export const genresResponseSchema = z.object({
  genres: z.array(genreSchema),
});

export type GenresResponse = z.infer<typeof genresResponseSchema>;

/** Core movie fields exposed by public browse and detail endpoints. */
export const movieSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  posterUrl: z.string().nullable(),
  runtimeMinutes: z.number(),
});

export type Movie = z.infer<typeof movieSchema>;

/** Movie row in list responses — includes associated genres for browse cards. */
export const movieListItemSchema = movieSchema.extend({
  genres: z.array(genreSchema),
});

export type MovieListItem = z.infer<typeof movieListItemSchema>;

/** Query params for GET /movies — all filters optional except pagination defaults. */
export const moviesListQuerySchema = z.object({
  genre: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort: z.enum(['title', 'newest']).default('newest'),
});

export type MoviesListQuery = z.infer<typeof moviesListQuerySchema>;

/** Response shape for GET /movies. */
export const moviesListResponseSchema = z.object({
  movies: z.array(movieListItemSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export type MoviesListResponse = z.infer<typeof moviesListResponseSchema>;

/** Response shape for GET /movies/:id. */
export const movieDetailResponseSchema = z.object({
  movie: movieSchema,
  genres: z.array(genreSchema),
  upcomingShowtimes: z.array(z.unknown()),
});

export type MovieDetailResponse = z.infer<typeof movieDetailResponseSchema>;

/** Request body for POST /movies and PUT /movies/:id (partial on update). */
export const createMovieRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  runtimeMinutes: z.number().int().min(1).max(600),
  genreIds: z.array(z.number().int().positive()).min(1),
  posterUrl: z.string().url().optional(),
});

export type CreateMovieRequest = z.infer<typeof createMovieRequestSchema>;

export const updateMovieRequestSchema = createMovieRequestSchema.partial();

export type UpdateMovieRequest = z.infer<typeof updateMovieRequestSchema>;

/** Response after creating or updating a movie (admin). */
export const movieMutationResponseSchema = z.object({
  movie: movieSchema,
  genres: z.array(genreSchema),
});

export type MovieMutationResponse = z.infer<typeof movieMutationResponseSchema>;

/** Response from POST /admin/uploads/poster. */
export const posterUploadResponseSchema = z.object({
  posterUrl: z.string().url(),
});

export type PosterUploadResponse = z.infer<typeof posterUploadResponseSchema>;
