import { queryRead, queryWrite } from '../db/pools.js';

export type SeatMapRow = {
  seat_id: number;
  label: string;
  row_label: string;
  col_number: number;
  status: 'available' | 'held' | 'reserved';
  row_count: number;
  col_count: number;
  price_cents: number;
};

export type HoldRecord = {
  id: string;
  userId: string;
  showtimeId: string;
  expiresAt: Date;
  releasedAt: Date | null;
};

export type HeldSeatRow = {
  seat_id: number;
  label: string;
};

export type ExpiredHoldRow = {
  id: string;
  showtime_id: string;
};

const SEATS_UNAVAILABLE_CODE = 'P0001';
const HOLD_NOT_FOUND_CODE = 'P0002';

export function isSeatsUnavailableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === SEATS_UNAVAILABLE_CODE
  );
}

export function isHoldNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === HOLD_NOT_FOUND_CODE
  );
}

export async function findSeatMapRows(showtimeId: string): Promise<SeatMapRow[]> {
  const result = await queryRead<SeatMapRow>(
    `SELECT
       s.id AS seat_id,
       s.label,
       s.row_label,
       s.col_number,
       ss.status,
       sc.row_count,
       sc.col_count,
       st.price_cents
     FROM showtimes st
     INNER JOIN screens sc ON sc.id = st.screen_id
     INNER JOIN showtime_seats ss ON ss.showtime_id = st.id
     INNER JOIN seats s ON s.id = ss.seat_id
     WHERE st.id = $1
     ORDER BY s.row_label ASC, s.col_number ASC`,
    [showtimeId],
  );

  return result.rows;
}

export async function findShowtimeStatus(showtimeId: string): Promise<string | null> {
  const result = await queryRead<{ status: string }>(
    `SELECT status FROM showtimes WHERE id = $1`,
    [showtimeId],
  );

  return result.rows[0]?.status ?? null;
}

export async function callHoldSeats(input: {
  holdId: string;
  userId: string;
  showtimeId: string;
  seatIds: number[];
  expiresAt: Date;
}): Promise<void> {
  await queryWrite(`SELECT fn_hold_seats($1, $2, $3, $4::integer[], $5)`, [
    input.holdId,
    input.userId,
    input.showtimeId,
    input.seatIds,
    input.expiresAt,
  ]);
}

export async function callReleaseHold(holdId: string, userId: string): Promise<void> {
  await queryWrite(`SELECT fn_release_hold($1, $2)`, [holdId, userId]);
}

export async function callExpireHold(holdId: string): Promise<number[]> {
  const result = await queryWrite<{ seat_ids: number[] }>(
    `SELECT fn_expire_hold($1) AS seat_ids`,
    [holdId],
  );

  return result.rows[0]?.seat_ids ?? [];
}

export async function findHoldById(holdId: string): Promise<HoldRecord | null> {
  const result = await queryRead<{
    id: string;
    user_id: string;
    showtime_id: string;
    expires_at: Date;
    released_at: Date | null;
  }>(
    `SELECT id, user_id, showtime_id, expires_at, released_at
     FROM seat_holds
     WHERE id = $1`,
    [holdId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    showtimeId: row.showtime_id,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
  };
}

export async function findHeldSeatsByHoldId(holdId: string): Promise<HeldSeatRow[]> {
  const result = await queryRead<HeldSeatRow>(
    `SELECT s.id AS seat_id, s.label
     FROM showtime_seats ss
     INNER JOIN seats s ON s.id = ss.seat_id
     WHERE ss.hold_id = $1
     ORDER BY s.row_label ASC, s.col_number ASC`,
    [holdId],
  );

  return result.rows;
}

export async function findExpiredHolds(limit = 100): Promise<ExpiredHoldRow[]> {
  const result = await queryRead<ExpiredHoldRow>(
    `SELECT id, showtime_id
     FROM seat_holds
     WHERE released_at IS NULL
       AND expires_at <= NOW()
     ORDER BY expires_at ASC
     LIMIT $1`,
    [limit],
  );

  return result.rows;
}

export async function findSeatIdsByHoldId(holdId: string): Promise<number[]> {
  const result = await queryRead<{ seat_id: number }>(
    `SELECT seat_id
     FROM showtime_seats
     WHERE hold_id = $1
     ORDER BY seat_id ASC`,
    [holdId],
  );

  return result.rows.map((row) => row.seat_id);
}
