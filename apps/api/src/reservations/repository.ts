import { queryRead, queryWrite } from '../db/pools.js';

export type ReservationRecord = {
  id: string;
  referenceCode: string;
  userId: string;
  showtimeId: string;
  holdId: string | null;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  totalAmountCents: number;
  currency: string;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

export type ReservationSeatRow = {
  label: string;
};

export type ReservationListFilters = {
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
  movieId?: string;
  page: number;
  limit: number;
};

export type ExpiredReservationBatch = {
  showtimeId: string;
  seatIds: number[];
};

const HOLD_NOT_FOUND_CODE = 'P0002';
const HOLD_FORBIDDEN_CODE = 'P0003';
const HOLD_EXPIRED_CODE = 'P0004';
const HOLD_CONSUMED_CODE = 'P0005';
const RESERVATION_NOT_FOUND_CODE = 'P0006';
const RESERVATION_FORBIDDEN_CODE = 'P0007';
const NOT_CANCELLABLE_CODE = 'P0008';

function mapReservation(row: {
  id: string;
  reference_code: string;
  user_id: string;
  showtime_id: string;
  hold_id: string | null;
  status: ReservationRecord['status'];
  total_amount_cents: number;
  currency: string;
  idempotency_key: string | null;
  expires_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
}): ReservationRecord {
  return {
    id: row.id,
    referenceCode: row.reference_code,
    userId: row.user_id,
    showtimeId: row.showtime_id,
    holdId: row.hold_id,
    status: row.status,
    totalAmountCents: row.total_amount_cents,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}

function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === code
  );
}

export function isHoldNotFoundError(error: unknown): boolean {
  return isPgError(error, HOLD_NOT_FOUND_CODE);
}

export function isHoldForbiddenError(error: unknown): boolean {
  return isPgError(error, HOLD_FORBIDDEN_CODE);
}

export function isHoldExpiredError(error: unknown): boolean {
  return isPgError(error, HOLD_EXPIRED_CODE);
}

export function isHoldConsumedError(error: unknown): boolean {
  return isPgError(error, HOLD_CONSUMED_CODE);
}

export function isReservationNotFoundError(error: unknown): boolean {
  return isPgError(error, RESERVATION_NOT_FOUND_CODE);
}

export function isReservationForbiddenError(error: unknown): boolean {
  return isPgError(error, RESERVATION_FORBIDDEN_CODE);
}

export function isNotCancellableError(error: unknown): boolean {
  return isPgError(error, NOT_CANCELLABLE_CODE);
}

const UNIQUE_VIOLATION_CODE = '23505';
const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'reservations_user_idempotency_unique';

export function isIdempotencyConflictError(error: unknown): boolean {
  if (!isPgError(error, UNIQUE_VIOLATION_CODE)) {
    return false;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'constraint' in error &&
    typeof (error as { constraint?: string }).constraint === 'string'
  ) {
    return (error as { constraint: string }).constraint === IDEMPOTENCY_UNIQUE_CONSTRAINT;
  }

  return true;
}

export async function findByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
): Promise<ReservationRecord | null> {
  return findByIdempotencyKeyInternal(userId, idempotencyKey, queryRead);
}

/** Primary read — use right after create for read-your-writes consistency. */
export async function findByIdempotencyKeyFromPrimary(
  userId: string,
  idempotencyKey: string,
): Promise<ReservationRecord | null> {
  return findByIdempotencyKeyInternal(userId, idempotencyKey, queryWrite);
}

async function findByIdempotencyKeyInternal(
  userId: string,
  idempotencyKey: string,
  query: typeof queryRead,
): Promise<ReservationRecord | null> {
  const result = await query<{
    id: string;
    reference_code: string;
    user_id: string;
    showtime_id: string;
    hold_id: string | null;
    status: ReservationRecord['status'];
    total_amount_cents: number;
    currency: string;
    idempotency_key: string | null;
    expires_at: Date | null;
    confirmed_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
  }>(
    `SELECT
       id,
       reference_code,
       user_id,
       showtime_id,
       hold_id,
       status,
       total_amount_cents,
       currency,
       idempotency_key,
       expires_at,
       confirmed_at,
       cancelled_at,
       created_at
     FROM reservations
     WHERE user_id = $1
       AND idempotency_key = $2`,
    [userId, idempotencyKey],
  );

  const row = result.rows[0];
  return row ? mapReservation(row) : null;
}

export async function callCreateReservation(input: {
  holdId: string;
  userId: string;
  idempotencyKey: string;
  referenceCode: string;
  expiresAt: Date;
}): Promise<string> {
  const result = await queryWrite<{ fn_create_reservation: string }>(
    `SELECT fn_create_reservation($1, $2, $3, $4, $5) AS fn_create_reservation`,
    [
      input.holdId,
      input.userId,
      input.idempotencyKey,
      input.referenceCode,
      input.expiresAt,
    ],
  );

  const reservationId = result.rows[0]?.fn_create_reservation;
  if (!reservationId) {
    throw new Error('Failed to create reservation');
  }

  return reservationId;
}

export async function findById(id: string): Promise<ReservationRecord | null> {
  return findByIdInternal(id, queryRead);
}

/** Primary read — use right after create for read-your-writes consistency. */
export async function findByIdFromPrimary(id: string): Promise<ReservationRecord | null> {
  return findByIdInternal(id, queryWrite);
}

async function findByIdInternal(
  id: string,
  query: typeof queryRead,
): Promise<ReservationRecord | null> {
  const result = await query<{
    id: string;
    reference_code: string;
    user_id: string;
    showtime_id: string;
    hold_id: string | null;
    status: ReservationRecord['status'];
    total_amount_cents: number;
    currency: string;
    idempotency_key: string | null;
    expires_at: Date | null;
    confirmed_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
  }>(
    `SELECT
       id,
       reference_code,
       user_id,
       showtime_id,
       hold_id,
       status,
       total_amount_cents,
       currency,
       idempotency_key,
       expires_at,
       confirmed_at,
       cancelled_at,
       created_at
     FROM reservations
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapReservation(row) : null;
}

export async function findSeatsByReservationId(
  reservationId: string,
): Promise<ReservationSeatRow[]> {
  return findSeatsByReservationIdInternal(reservationId, queryRead);
}

/** Primary read — use right after create for read-your-writes consistency. */
export async function findSeatsByReservationIdFromPrimary(
  reservationId: string,
): Promise<ReservationSeatRow[]> {
  return findSeatsByReservationIdInternal(reservationId, queryWrite);
}

async function findSeatsByReservationIdInternal(
  reservationId: string,
  query: typeof queryRead,
): Promise<ReservationSeatRow[]> {
  const result = await query<ReservationSeatRow>(
    `SELECT s.label
     FROM reservation_seats rs
     INNER JOIN showtime_seats ss ON ss.id = rs.showtime_seat_id
     INNER JOIN seats s ON s.id = ss.seat_id
     WHERE rs.reservation_id = $1
     ORDER BY s.row_label ASC, s.col_number ASC`,
    [reservationId],
  );

  return result.rows;
}

export async function listReservations(
  filters: ReservationListFilters,
): Promise<{ items: ReservationRecord[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.userId) {
    params.push(filters.userId);
    conditions.push(`r.user_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`r.status = $${params.length}`);
  }

  if (filters.from) {
    params.push(filters.from);
    conditions.push(`r.created_at >= $${params.length}::timestamptz`);
  }

  if (filters.to) {
    params.push(filters.to);
    conditions.push(`r.created_at <= $${params.length}::timestamptz`);
  }

  if (filters.movieId) {
    params.push(filters.movieId);
    conditions.push(`st.movie_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (filters.page - 1) * filters.limit;

  const countResult = await queryRead<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM reservations r
     INNER JOIN showtimes st ON st.id = r.showtime_id
     ${whereClause}`,
    params,
  );

  params.push(filters.limit, offset);

  const listResult = await queryRead<{
    id: string;
    reference_code: string;
    user_id: string;
    showtime_id: string;
    hold_id: string | null;
    status: ReservationRecord['status'];
    total_amount_cents: number;
    currency: string;
    idempotency_key: string | null;
    expires_at: Date | null;
    confirmed_at: Date | null;
    cancelled_at: Date | null;
    created_at: Date;
  }>(
    `SELECT
       r.id,
       r.reference_code,
       r.user_id,
       r.showtime_id,
       r.hold_id,
       r.status,
       r.total_amount_cents,
       r.currency,
       r.idempotency_key,
       r.expires_at,
       r.confirmed_at,
       r.cancelled_at,
       r.created_at
     FROM reservations r
     INNER JOIN showtimes st ON st.id = r.showtime_id
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params,
  );

  return {
    items: listResult.rows.map(mapReservation),
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

export async function callCancelReservation(
  reservationId: string,
  userId: string,
): Promise<number[]> {
  const result = await queryWrite<{ seat_ids: number[] }>(
    `SELECT fn_cancel_reservation($1, $2) AS seat_ids`,
    [reservationId, userId],
  );

  return result.rows[0]?.seat_ids ?? [];
}

export async function callExpirePendingReservations(): Promise<ExpiredReservationBatch[]> {
  const result = await queryWrite<{ showtime_id: string; seat_ids: number[] }>(
    `SELECT showtime_id, seat_ids FROM fn_expire_pending_reservations()`,
  );

  return result.rows.map((row) => ({
    showtimeId: row.showtime_id,
    seatIds: row.seat_ids ?? [],
  }));
}
