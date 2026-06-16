/**
 * Re-export shared seat/hold schemas so route handlers import from one place.
 */
export {
  holdSeatsRequestSchema,
  holdSeatsResponseSchema,
  holdStatusResponseSchema,
  releaseHoldRequestSchema,
  seatMapResponseSchema,
} from '@repo/shared';
