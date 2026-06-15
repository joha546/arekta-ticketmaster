/**
 * Re-export shared showtime schemas so route handlers import from one place.
 */
export {
  createShowtimeRequestSchema,
  showtimeMutationResponseSchema,
  showtimesByDateQuerySchema,
  showtimesListResponseSchema,
  updateShowtimeRequestSchema,
} from '@repo/shared';
