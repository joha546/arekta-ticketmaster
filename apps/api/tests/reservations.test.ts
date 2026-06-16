import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  cancelReservationResponseSchema,
  createReservationResponseSchema,
  reservationDetailResponseSchema,
  reservationListResponseSchema,
} from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead, queryWrite } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';
import { REFERENCE_CODE_PATTERN } from '../src/reservations/referenceCode.js';
import { createReservationsService } from '../src/reservations/service.js';
import * as reservationsRepo from '../src/reservations/repository.js';
import { signTestToken } from './helpers/jwt.js';
import { resetMockRedisStore } from './setup.js';

const SHOWTIME_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PAST_SHOWTIME_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MOVIE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_USER_ID = '11111111-1111-1111-1111-111111111111';
const UNVERIFIED_USER_ID = '44444444-4444-4444-4444-444444444444';

const IDEM_PENDING = '11111111-1111-4111-8111-111111111101';
const IDEM_PRICE = '11111111-1111-4111-8111-111111111102';
const IDEM_REF = '11111111-1111-4111-8111-111111111103';
const IDEM_REPLAY = '11111111-1111-4111-8111-111111111104';
const IDEM_FIRST_KEY = '11111111-1111-4111-8111-111111111105';
const IDEM_SECOND_KEY = '11111111-1111-4111-8111-111111111106';
const IDEM_EXPIRED_HOLD = '11111111-1111-4111-8111-111111111107';
const IDEM_WRONG_USER = '11111111-1111-4111-8111-111111111108';
const IDEM_OWN_LIST = '11111111-1111-4111-8111-111111111109';
const IDEM_OTHER_LIST = '11111111-1111-4111-8111-111111111110';
const IDEM_ADMIN_LIST_1 = '11111111-1111-4111-8111-111111111111';
const IDEM_ADMIN_LIST_2 = '11111111-1111-4111-8111-111111111112';
const IDEM_DETAIL_LABELS = '11111111-1111-4111-8111-111111111113';
const IDEM_DETAIL_FORBIDDEN = '11111111-1111-4111-8111-111111111114';
const IDEM_CANCEL_UPCOMING = '11111111-1111-4111-8111-111111111115';
const IDEM_PAST_CANCEL = '11111111-1111-4111-8111-111111111116';
const IDEM_EXPIRE_JOB = '11111111-1111-4111-8111-111111111117';
const IDEM_RACE_REPLAY = '11111111-1111-4111-8111-111111111118';

const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const COLS = 12;

type ShowtimeRow = {
  id: string;
  movie_id: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  price_cents: number;
  screen_id: number;
  start_time: Date;
  end_time: Date;
};

type SeatDefinition = {
  id: number;
  label: string;
  row_label: string;
  col_number: number;
  screen_id: number;
};

type ShowtimeSeatState = {
  id: number;
  showtime_id: string;
  seat_id: number;
  status: 'available' | 'held' | 'reserved';
  version: number;
  hold_id: string | null;
  reservation_id: string | null;
};

type HoldRow = {
  id: string;
  user_id: string;
  showtime_id: string;
  expires_at: Date;
  released_at: Date | null;
};

type ReservationRow = {
  id: string;
  reference_code: string;
  user_id: string;
  showtime_id: string;
  hold_id: string | null;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  total_amount_cents: number;
  currency: string;
  idempotency_key: string | null;
  expires_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
};

type UserRow = {
  id: string;
  email: string;
  email_verified_at: Date | null;
  role: 'admin' | 'user';
};

const showtimes = new Map<string, ShowtimeRow>();
const screenSeats = new Map<number, SeatDefinition>();
const showtimeSeats = new Map<string, ShowtimeSeatState[]>();
const holds = new Map<string, HoldRow>();
const reservations = new Map<string, ReservationRow>();
const reservationSeatLinks = new Map<string, number[]>();
const users = new Map<string, UserRow>();

let nextShowtimeSeatId = 1;

const verifiedToken = signTestToken({
  sub: USER_ID,
  email: 'user@arekta.local',
  role: 'user',
});

const otherUserToken = signTestToken({
  sub: OTHER_USER_ID,
  email: 'other@arekta.local',
  role: 'user',
});

const adminToken = signTestToken({
  sub: ADMIN_USER_ID,
  email: 'admin@arekta.local',
  role: 'admin',
});

const env = loadEnv();
const logger = createLogger({
  ...env,
  LOG_LEVEL: 'silent',
  HOLD_TTL_SECONDS: 600,
  RESERVATION_TTL_SECONDS: 900,
});
const app = createApp(
  { ...env, HOLD_TTL_SECONDS: 600, RESERVATION_TTL_SECONDS: 900, IMGBB_API_KEY: 'test-imgbb-key' },
  logger,
);
const reservationsService = createReservationsService({
  ...env,
  RESERVATION_TTL_SECONDS: 900,
});

function seedScreenSeats(): void {
  screenSeats.clear();
  let seatId = 1;
  for (const rowLabel of ROW_LABELS) {
    for (let col = 1; col <= COLS; col += 1) {
      screenSeats.set(seatId, {
        id: seatId,
        label: `${rowLabel}${col}`,
        row_label: rowLabel,
        col_number: col,
        screen_id: 1,
      });
      seatId += 1;
    }
  }
}

function seedShowtime(
  id = SHOWTIME_ID,
  options?: { startTime?: Date; priceCents?: number },
): void {
  const startTime = options?.startTime ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  showtimes.set(id, {
    id,
    movie_id: MOVIE_ID,
    status: 'scheduled',
    price_cents: options?.priceCents ?? 1200,
    screen_id: 1,
    start_time: startTime,
    end_time: new Date(startTime.getTime() + 2 * 60 * 60 * 1000),
  });

  showtimeSeats.set(
    id,
    [...screenSeats.values()].map((seat) => ({
      id: nextShowtimeSeatId++,
      showtime_id: id,
      seat_id: seat.id,
      status: 'available' as const,
      version: 0,
      hold_id: null,
      reservation_id: null,
    })),
  );
}

function seedUsers(): void {
  users.set(USER_ID, {
    id: USER_ID,
    email: 'user@arekta.local',
    email_verified_at: new Date(),
    role: 'user',
  });
  users.set(OTHER_USER_ID, {
    id: OTHER_USER_ID,
    email: 'other@arekta.local',
    email_verified_at: new Date(),
    role: 'user',
  });
  users.set(ADMIN_USER_ID, {
    id: ADMIN_USER_ID,
    email: 'admin@arekta.local',
    email_verified_at: new Date(),
    role: 'admin',
  });
  users.set(UNVERIFIED_USER_ID, {
    id: UNVERIFIED_USER_ID,
    email: 'unverified@arekta.local',
    email_verified_at: null,
    role: 'user',
  });
}

function getShowtimeSeat(showtimeId: string, seatId: number): ShowtimeSeatState | undefined {
  return showtimeSeats.get(showtimeId)?.find((seat) => seat.seat_id === seatId);
}

function simulateHoldSeats(
  holdId: string,
  userId: string,
  showtimeId: string,
  seatIds: number[],
  expiresAt: Date,
): void {
  for (const seatId of seatIds) {
    const seat = getShowtimeSeat(showtimeId, seatId);
    if (!seat || seat.status !== 'available') {
      const error = new Error('seats_unavailable') as Error & { code: string };
      error.code = 'P0001';
      throw error;
    }
  }

  for (const seatId of seatIds) {
    const seat = getShowtimeSeat(showtimeId, seatId);
    if (!seat) {
      continue;
    }
    seat.status = 'held';
    seat.hold_id = holdId;
    seat.version += 1;
  }

  holds.set(holdId, {
    id: holdId,
    user_id: userId,
    showtime_id: showtimeId,
    expires_at: expiresAt,
    released_at: null,
  });
}

function simulateCreateReservation(
  holdId: string,
  userId: string,
  idempotencyKey: string,
  referenceCode: string,
  expiresAt: Date,
): string {
  const hold = holds.get(holdId);
  if (!hold) {
    const error = new Error('hold_not_found') as Error & { code: string };
    error.code = 'P0002';
    throw error;
  }
  if (hold.user_id !== userId) {
    const error = new Error('hold_forbidden') as Error & { code: string };
    error.code = 'P0003';
    throw error;
  }
  if (hold.released_at !== null || hold.expires_at.getTime() <= Date.now()) {
    const error = new Error('hold_expired') as Error & { code: string };
    error.code = 'P0004';
    throw error;
  }
  if ([...reservations.values()].some((row) => row.hold_id === holdId)) {
    const error = new Error('hold_consumed') as Error & { code: string };
    error.code = 'P0005';
    throw error;
  }

  const heldSeats = (showtimeSeats.get(hold.showtime_id) ?? []).filter(
    (seat) => seat.hold_id === holdId && seat.status === 'held',
  );
  if (heldSeats.length === 0) {
    const error = new Error('hold_not_found') as Error & { code: string };
    error.code = 'P0002';
    throw error;
  }

  const showtime = showtimes.get(hold.showtime_id);
  if (!showtime) {
    throw new Error('showtime_not_found');
  }

  const reservationId = randomUUID();
  const totalAmountCents = heldSeats.length * showtime.price_cents;

  reservations.set(reservationId, {
    id: reservationId,
    reference_code: referenceCode,
    user_id: userId,
    showtime_id: hold.showtime_id,
    hold_id: holdId,
    status: 'pending',
    total_amount_cents: totalAmountCents,
    currency: 'USD',
    idempotency_key: idempotencyKey,
    expires_at: expiresAt,
    confirmed_at: null,
    cancelled_at: null,
    created_at: new Date(),
  });

  reservationSeatLinks.set(
    reservationId,
    heldSeats.map((seat) => seat.id),
  );

  for (const seat of heldSeats) {
    seat.reservation_id = reservationId;
  }

  return reservationId;
}

function simulateCancelReservation(reservationId: string, userId: string): number[] {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    const error = new Error('reservation_not_found') as Error & { code: string };
    error.code = 'P0006';
    throw error;
  }
  if (reservation.user_id !== userId) {
    const error = new Error('reservation_forbidden') as Error & { code: string };
    error.code = 'P0007';
    throw error;
  }

  const showtime = showtimes.get(reservation.showtime_id);
  if (
    !showtime ||
    !['pending', 'confirmed'].includes(reservation.status) ||
    showtime.start_time.getTime() <= Date.now()
  ) {
    const error = new Error('not_cancellable') as Error & { code: string };
    error.code = 'P0008';
    throw error;
  }

  reservation.status = 'cancelled';
  reservation.cancelled_at = new Date();

  const releasedSeatIds: number[] = [];
  for (const seat of showtimeSeats.get(reservation.showtime_id) ?? []) {
    if (seat.reservation_id === reservationId) {
      seat.status = 'available';
      seat.hold_id = null;
      seat.reservation_id = null;
      seat.version += 1;
      releasedSeatIds.push(seat.seat_id);
    }
  }

  const hold = reservation.hold_id ? holds.get(reservation.hold_id) : undefined;
  if (hold && hold.released_at === null) {
    hold.released_at = new Date();
  }

  return releasedSeatIds;
}

function simulateExpirePendingReservations(): Array<{ showtime_id: string; seat_ids: number[] }> {
  const batches: Array<{ showtime_id: string; seat_ids: number[] }> = [];

  for (const reservation of reservations.values()) {
    if (
      reservation.status !== 'pending' ||
      !reservation.expires_at ||
      reservation.expires_at.getTime() > Date.now()
    ) {
      continue;
    }

    reservation.status = 'expired';
    const releasedSeatIds: number[] = [];

    for (const seat of showtimeSeats.get(reservation.showtime_id) ?? []) {
      if (seat.reservation_id === reservation.id && seat.status === 'held') {
        seat.status = 'available';
        seat.hold_id = null;
        seat.reservation_id = null;
        seat.version += 1;
        releasedSeatIds.push(seat.seat_id);
      }
    }

    const hold = reservation.hold_id ? holds.get(reservation.hold_id) : undefined;
    if (hold && hold.released_at === null) {
      hold.released_at = new Date();
    }

    if (releasedSeatIds.length > 0) {
      batches.push({ showtime_id: reservation.showtime_id, seat_ids: releasedSeatIds });
    }
  }

  return batches;
}

function reservationRowsForQuery(sql: string, params?: unknown[]) {
  if (sql.includes('idempotency_key = $2')) {
    const userId = params?.[0] as string;
    const key = params?.[1] as string;
    const row = [...reservations.values()].find(
      (reservation) => reservation.user_id === userId && reservation.idempotency_key === key,
    );
    return row ? [row] : [];
  }

  if (sql.includes('FROM reservations') && sql.includes('WHERE id = $1')) {
    const id = params?.[0] as string;
    const row = reservations.get(id);
    return row ? [row] : [];
  }

  if (sql.includes('FROM reservation_seats rs')) {
    const reservationId = params?.[0] as string;
    const seatIds = reservationSeatLinks.get(reservationId) ?? [];
    const rows = seatIds
      .map((showtimeSeatId) => {
        for (const states of showtimeSeats.values()) {
          const state = states.find((seat) => seat.id === showtimeSeatId);
          if (state) {
            const seat = screenSeats.get(state.seat_id);
            return seat ? { label: seat.label } : null;
          }
        }
        return null;
      })
      .filter((row): row is { label: string } => row !== null);
    return rows;
  }

  if (sql.includes('SELECT COUNT(*)::text AS total') && sql.includes('FROM reservations r')) {
    const filtered = filterReservationsForList(sql, params);
    return [{ total: String(filtered.length) }];
  }

  if (sql.includes('FROM reservations r') && sql.includes('ORDER BY r.created_at DESC')) {
    const filtered = filterReservationsForList(sql, params);
    const limit = Number(params?.[params.length - 2]);
    const offset = Number(params?.[params.length - 1]);
    return filtered.slice(offset, offset + limit);
  }

  return [];
}

function filterReservationsForList(sql: string, params?: unknown[]): ReservationRow[] {
  let rows = [...reservations.values()];

  if (sql.includes('r.user_id = $')) {
    const userId = params?.[0] as string;
    rows = rows.filter((row) => row.user_id === userId);
  }

  if (sql.includes('r.status = $')) {
    const statusIndex = sql.includes('r.user_id = $') ? 1 : 0;
    const status = params?.[statusIndex] as ReservationRow['status'];
    rows = rows.filter((row) => row.status === status);
  }

  if (sql.includes('st.movie_id = $')) {
    const movieId = params?.find((_, index) => sql.includes(`st.movie_id = $${index + 1}`)) as
      | string
      | undefined;
    if (movieId) {
      rows = rows.filter((row) => showtimes.get(row.showtime_id)?.movie_id === movieId);
    }
  }

  return rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

function installDbMocks(): void {
  const handleRead = async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM showtimes st') && sql.includes('INNER JOIN screens sc')) {
      const showtimeId = params?.[0] as string;
      const showtime = showtimes.get(showtimeId);
      if (!showtime) {
        return { rows: [], rowCount: 0 };
      }
      const rows = (showtimeSeats.get(showtimeId) ?? [])
        .map((state) => {
          const seat = screenSeats.get(state.seat_id);
          if (!seat) {
            return null;
          }
          return {
            seat_id: seat.id,
            label: seat.label,
            row_label: seat.row_label,
            col_number: seat.col_number,
            status: state.status,
            row_count: ROW_LABELS.length,
            col_count: COLS,
            price_cents: showtime.price_cents,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('SELECT status FROM showtimes WHERE id = $1')) {
      const showtimeId = params?.[0] as string;
      const showtime = showtimes.get(showtimeId);
      return { rows: showtime ? [{ status: showtime.status }] : [], rowCount: showtime ? 1 : 0 };
    }

    if (sql.includes('FROM seat_holds') && sql.includes('WHERE id = $1')) {
      const holdId = params?.[0] as string;
      const hold = holds.get(holdId);
      return {
        rows: hold
          ? [
              {
                id: hold.id,
                user_id: hold.user_id,
                showtime_id: hold.showtime_id,
                expires_at: hold.expires_at,
                released_at: hold.released_at,
              },
            ]
          : [],
        rowCount: hold ? 1 : 0,
      };
    }

    if (sql.includes('FROM reservations') || sql.includes('FROM reservation_seats')) {
      const rows = reservationRowsForQuery(sql, params).map((row) =>
        'reference_code' in row
          ? row
          : row,
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM users WHERE id = $1')) {
      const userId = params?.[0] as string;
      const user = users.get(userId);
      if (!user) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            id: user.id,
            email: user.email,
            password_hash: null,
            name: 'Test User',
            role: user.role,
            email_verified_at: user.email_verified_at,
            google_id: null,
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  };

  const handleWrite = async (sql: string, params?: unknown[]) => {
    if (sql.includes('fn_hold_seats')) {
      simulateHoldSeats(
        params?.[0] as string,
        params?.[1] as string,
        params?.[2] as string,
        params?.[3] as number[],
        params?.[4] as Date,
      );
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('fn_create_reservation')) {
      const reservationId = simulateCreateReservation(
        params?.[0] as string,
        params?.[1] as string,
        params?.[2] as string,
        params?.[3] as string,
        params?.[4] as Date,
      );
      return { rows: [{ fn_create_reservation: reservationId }], rowCount: 1 };
    }

    if (sql.includes('fn_cancel_reservation')) {
      const seatIds = simulateCancelReservation(params?.[0] as string, params?.[1] as string);
      return { rows: [{ seat_ids: seatIds }], rowCount: 1 };
    }

    if (sql.includes('fn_expire_pending_reservations')) {
      const rows = simulateExpirePendingReservations();
      return { rows, rowCount: rows.length };
    }

    if (sql.trimStart().startsWith('SELECT')) {
      return handleRead(sql, params);
    }

    return { rows: [], rowCount: 0 };
  };

  vi.mocked(queryRead).mockImplementation(handleRead);
  vi.mocked(queryWrite).mockImplementation(handleWrite);
}

async function holdSeats(seatIds: number[]): Promise<string> {
  const res = await request(app)
    .post('/seats/hold')
    .set('Authorization', `Bearer ${verifiedToken}`)
    .send({ showtimeId: SHOWTIME_ID, seatIds });

  expect(res.status).toBe(200);
  return res.body.holdToken as string;
}

describe('Reservations API', () => {
  beforeEach(() => {
    showtimes.clear();
    showtimeSeats.clear();
    holds.clear();
    reservations.clear();
    reservationSeatLinks.clear();
    users.clear();
    nextShowtimeSeatId = 1;
    resetMockRedisStore();
    installDbMocks();
    seedScreenSeats();
    seedShowtime();
    seedShowtime(PAST_SHOWTIME_ID, { startTime: new Date(Date.now() - 60 * 60 * 1000) });
    seedUsers();
  });

  it('POST /reservations valid hold → 201 pending', async () => {
    const holdToken = await holdSeats([5, 6]);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_PENDING)
      .send({ holdToken });

    expect(res.status).toBe(201);
    const parsed = createReservationResponseSchema.parse(res.body);
    expect(parsed.reservation.status).toBe('pending');
    expect(parsed.paymentUrl).toBeNull();
  });

  it('totalAmountCents = seat_count × showtime.price_cents', async () => {
    const holdToken = await holdSeats([1, 2, 3]);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_PRICE)
      .send({ holdToken });

    expect(res.status).toBe(201);
    expect(res.body.reservation.totalAmountCents).toBe(3 * 1200);
  });

  it('reference_code matches format', async () => {
    const holdToken = await holdSeats([4]);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_REF)
      .send({ holdToken });

    expect(res.status).toBe(201);
    expect(res.body.reservation.referenceCode).toMatch(REFERENCE_CODE_PATTERN);
  });

  it('replay same X-Idempotency-Key → same reservation id', async () => {
    const holdToken = await holdSeats([7]);

    const first = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_REPLAY)
      .send({ holdToken });

    const second = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_REPLAY)
      .send({ holdToken });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.reservation.id).toBe(first.body.reservation.id);
  });

  it('different idempotency key, same hold already consumed → 409', async () => {
    const holdToken = await holdSeats([8]);

    await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_FIRST_KEY)
      .send({ holdToken });

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_SECOND_KEY)
      .send({ holdToken });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOLD_CONSUMED');
  });

  it('expired hold → 409 HOLD_EXPIRED', async () => {
    const holdToken = await holdSeats([9]);
    const hold = holds.get(holdToken);
    if (hold) {
      hold.expires_at = new Date(Date.now() - 1000);
    }

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_EXPIRED_HOLD)
      .send({ holdToken });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('hold owned by another user → 403', async () => {
    const holdToken = await holdSeats([10]);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Idempotency-Key', IDEM_WRONG_USER)
      .send({ holdToken });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /reservations user sees only own', async () => {
    const holdToken = await holdSeats([11]);
    await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_OWN_LIST)
      .send({ holdToken });

    const otherHold = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [12] });
    await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Idempotency-Key', IDEM_OTHER_LIST)
      .send({ holdToken: otherHold.body.holdToken });

    const res = await request(app)
      .get('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    const parsed = reservationListResponseSchema.parse(res.body);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.referenceCode).toBeTruthy();
  });

  it('GET /reservations admin sees all', async () => {
    const holdToken = await holdSeats([13]);
    await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_ADMIN_LIST_1)
      .send({ holdToken });

    const otherHold = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [14] });
    await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Idempotency-Key', IDEM_ADMIN_LIST_2)
      .send({ holdToken: otherHold.body.holdToken });

    const res = await request(app)
      .get('/reservations')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('GET /reservations/:id includes seat labels', async () => {
    const holdToken = await holdSeats([15, 16]);
    const createRes = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_DETAIL_LABELS)
      .send({ holdToken });

    const res = await request(app)
      .get(`/reservations/${createRes.body.reservation.id}`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    const parsed = reservationDetailResponseSchema.parse(res.body);
    expect(parsed.reservation.seats).toEqual([{ label: 'B3' }, { label: 'B4' }]);
  });

  it('GET /reservations/:id other user → 403', async () => {
    const holdToken = await holdSeats([17]);
    const createRes = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_DETAIL_FORBIDDEN)
      .send({ holdToken });

    const res = await request(app)
      .get(`/reservations/${createRes.body.reservation.id}`)
      .set('Authorization', `Bearer ${otherUserToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('DELETE /reservations/:id upcoming pending → 200 { success: true }', async () => {
    const holdToken = await holdSeats([18]);
    const createRes = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_CANCEL_UPCOMING)
      .send({ holdToken });

    const res = await request(app)
      .delete(`/reservations/${createRes.body.reservation.id}`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    expect(cancelReservationResponseSchema.parse(res.body)).toEqual({ success: true });
    expect(getShowtimeSeat(SHOWTIME_ID, 18)?.status).toBe('available');
  });

  it('DELETE past showtime → 400 NOT_CANCELLABLE', async () => {
    const pastHold = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: PAST_SHOWTIME_ID, seatIds: [1] });

    const createRes = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_PAST_CANCEL)
      .send({ holdToken: pastHold.body.holdToken });

    const res = await request(app)
      .delete(`/reservations/${createRes.body.reservation.id}`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_CANCELLABLE');
  });

  it('pending reservation past expires_at → job sets expired, seats released', async () => {
    const holdToken = await holdSeats([19]);
    const createRes = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_EXPIRE_JOB)
      .send({ holdToken });

    const reservation = reservations.get(createRes.body.reservation.id);
    if (reservation) {
      reservation.expires_at = new Date(Date.now() - 1000);
    }

    const expired = await reservationsService.expireStaleReservations();
    expect(expired).toBe(1);
    expect(reservation?.status).toBe('expired');
    expect(getShowtimeSeat(SHOWTIME_ID, 19)?.status).toBe('available');
  });

  it('without idempotency header → 400', async () => {
    const holdToken = await holdSeats([20]);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ holdToken });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invalid idempotency key format → 400', async () => {
    const holdToken = await holdSeats([21]);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', 'postman-test-001')
      .send({ holdToken });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('HOLD_CONSUMED race with same idempotency key → replays instead of 409', async () => {
    const holdToken = await holdSeats([22]);

    await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_RACE_REPLAY)
      .send({ holdToken });

    const existing = await reservationsRepo.findByIdempotencyKeyFromPrimary(
      USER_ID,
      IDEM_RACE_REPLAY,
    );
    expect(existing).not.toBeNull();

    vi.spyOn(reservationsRepo, 'findByIdempotencyKeyFromPrimary')
      .mockResolvedValueOnce(null)
      .mockResolvedValue(existing);

    const holdConsumed = Object.assign(new Error('hold consumed'), { code: 'P0005' });
    vi.spyOn(reservationsRepo, 'callCreateReservation').mockRejectedValueOnce(holdConsumed);

    const res = await request(app)
      .post('/reservations')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .set('X-Idempotency-Key', IDEM_RACE_REPLAY)
      .send({ holdToken });

    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(res.body.reservation.id).toBe(existing!.id);
  });
});
