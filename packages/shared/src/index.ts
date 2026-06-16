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

export const showtimeStatusSchema = z.enum(['scheduled', 'cancelled', 'completed']);

export type ShowtimeStatus = z.infer<typeof showtimeStatusSchema>;

/** Public showtime row in list responses. */
export const showtimeListItemSchema = z.object({
  id: z.string().uuid(),
  startTime: z.string(),
  endTime: z.string(),
  priceCents: z.number(),
  status: showtimeStatusSchema,
  availableSeatCount: z.number(),
});

export type ShowtimeListItem = z.infer<typeof showtimeListItemSchema>;

/** Upcoming showtime summary on movie detail. */
export const upcomingShowtimeSchema = z.object({
  id: z.string().uuid(),
  startTime: z.string(),
  endTime: z.string(),
  priceCents: z.number(),
  status: showtimeStatusSchema,
});

export type UpcomingShowtime = z.infer<typeof upcomingShowtimeSchema>;

/** Query params for GET /movies/:id/showtimes. */
export const showtimesByDateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export type ShowtimesByDateQuery = z.infer<typeof showtimesByDateQuerySchema>;

/** Response shape for GET /movies/:id/showtimes. */
export const showtimesListResponseSchema = z.object({
  showtimes: z.array(showtimeListItemSchema),
});

export type ShowtimesListResponse = z.infer<typeof showtimesListResponseSchema>;

/** Request body for POST /showtimes. */
export const createShowtimeRequestSchema = z.object({
  movieId: z.string().uuid(),
  startTime: z.string().datetime(),
  priceCents: z.number().int().min(0),
});

export type CreateShowtimeRequest = z.infer<typeof createShowtimeRequestSchema>;

/** Request body for PUT /showtimes/:id. */
export const updateShowtimeRequestSchema = z.object({
  startTime: z.string().datetime().optional(),
  priceCents: z.number().int().min(0).optional(),
});

export type UpdateShowtimeRequest = z.infer<typeof updateShowtimeRequestSchema>;

/** Core showtime fields returned by admin mutations. */
export const showtimeSchema = z.object({
  id: z.string().uuid(),
  movieId: z.string().uuid(),
  screenId: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  priceCents: z.number(),
  status: showtimeStatusSchema,
});

export type Showtime = z.infer<typeof showtimeSchema>;

/** Response after creating or updating a showtime. */
export const showtimeMutationResponseSchema = z.object({
  showtime: showtimeSchema,
});

export type ShowtimeMutationResponse = z.infer<typeof showtimeMutationResponseSchema>;

/** Response shape for GET /movies/:id. */
export const movieDetailResponseSchema = z.object({
  movie: movieSchema,
  genres: z.array(genreSchema),
  upcomingShowtimes: z.array(upcomingShowtimeSchema),
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

export const seatStatusSchema = z.enum(['available', 'held', 'reserved']);

export type SeatStatus = z.infer<typeof seatStatusSchema>;

/** Single cell in the seat map grid. */
export const seatMapCellSchema = z.object({
  seatId: z.number().int().positive(),
  label: z.string(),
  status: seatStatusSchema,
});

export type SeatMapCell = z.infer<typeof seatMapCellSchema>;

/** Response shape for GET /showtimes/:id/seats. */
export const seatMapResponseSchema = z.object({
  showtimeId: z.string().uuid(),
  priceCents: z.number().int().min(0),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  seats: z.array(z.array(seatMapCellSchema)),
});

export type SeatMapResponse = z.infer<typeof seatMapResponseSchema>;

/** Request body for POST /seats/hold. */
export const holdSeatsRequestSchema = z.object({
  showtimeId: z.string().uuid(),
  seatIds: z
    .array(z.number().int().positive())
    .min(1, 'At least one seat is required')
    .max(10, 'Cannot hold more than 10 seats'),
});

export type HoldSeatsRequest = z.infer<typeof holdSeatsRequestSchema>;

/** Request body for DELETE /seats/hold. */
export const releaseHoldRequestSchema = z.object({
  holdToken: z.string().uuid(),
});

export type ReleaseHoldRequest = z.infer<typeof releaseHoldRequestSchema>;

/** Held seat summary returned by hold endpoints. */
export const heldSeatSchema = z.object({
  seatId: z.number().int().positive(),
  label: z.string(),
});

export type HeldSeat = z.infer<typeof heldSeatSchema>;

/** Response shape for POST /seats/hold. */
export const holdSeatsResponseSchema = z.object({
  holdToken: z.string().uuid(),
  expiresAt: z.string(),
  seats: z.array(heldSeatSchema),
});

export type HoldSeatsResponse = z.infer<typeof holdSeatsResponseSchema>;

/** Response shape for GET /seats/hold/:holdToken. */
export const holdStatusResponseSchema = z.object({
  holdToken: z.string().uuid(),
  showtimeId: z.string().uuid(),
  expiresAt: z.string(),
  seats: z.array(heldSeatSchema),
});

export type HoldStatusResponse = z.infer<typeof holdStatusResponseSchema>;

export const reservationStatusSchema = z.enum(['pending', 'confirmed', 'expired', 'cancelled']);

export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

/** Request body for POST /reservations. */
export const createReservationRequestSchema = z.object({
  holdToken: z.string().uuid(),
});

export type CreateReservationRequest = z.infer<typeof createReservationRequestSchema>;

/** Seat label summary on reservation responses. */
export const reservationSeatSchema = z.object({
  label: z.string(),
});

export type ReservationSeat = z.infer<typeof reservationSeatSchema>;

/** Reservation payload returned by create and detail endpoints. */
export const reservationSchema = z.object({
  id: z.string().uuid(),
  referenceCode: z.string(),
  status: reservationStatusSchema,
  totalAmountCents: z.number().int().min(0),
  currency: z.string().length(3),
  expiresAt: z.string().nullable(),
  showtimeId: z.string().uuid().optional(),
  seats: z.array(reservationSeatSchema),
});

export type Reservation = z.infer<typeof reservationSchema>;

/** Response shape for POST /reservations. */
export const createReservationResponseSchema = z.object({
  reservation: reservationSchema,
  paymentUrl: z.null(),
});

export type CreateReservationResponse = z.infer<typeof createReservationResponseSchema>;

/** Query params for GET /reservations. */
export const reservationListQuerySchema = paginationSchema.extend({
  status: reservationStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  movieId: z.string().uuid().optional(),
});

export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

/** Summary row in GET /reservations list. */
export const reservationListItemSchema = z.object({
  id: z.string().uuid(),
  referenceCode: z.string(),
  status: reservationStatusSchema,
  totalAmountCents: z.number().int().min(0),
  currency: z.string().length(3),
  expiresAt: z.string().nullable(),
  showtimeId: z.string().uuid(),
  createdAt: z.string(),
});

export type ReservationListItem = z.infer<typeof reservationListItemSchema>;

export const reservationListResponseSchema = paginatedResponseSchema(reservationListItemSchema);

export type ReservationListResponse = z.infer<typeof reservationListResponseSchema>;

/** Response shape for GET /reservations/:id. */
export const reservationDetailResponseSchema = z.object({
  reservation: reservationSchema.extend({
    showtimeId: z.string().uuid(),
  }),
});

export type ReservationDetailResponse = z.infer<typeof reservationDetailResponseSchema>;

/** Response shape for DELETE /reservations/:id. */
export const cancelReservationResponseSchema = z.object({
  success: z.literal(true),
});

export type CancelReservationResponse = z.infer<typeof cancelReservationResponseSchema>;
