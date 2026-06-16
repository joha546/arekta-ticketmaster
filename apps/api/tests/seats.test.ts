import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  holdSeatsResponseSchema,
  holdStatusResponseSchema,
  seatMapResponseSchema,
} from '@repo/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead, queryWrite } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';
import { createSeatsService } from '../src/seats/service.js';
import { signTestToken } from './helpers/jwt.js';
import { resetMockRedisStore } from './setup.js';

const SHOWTIME_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_SHOWTIME_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';
const UNVERIFIED_USER_ID = '44444444-4444-4444-4444-444444444444';

const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const COLS = 12;

type ShowtimeRow = {
  id: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  price_cents: number;
  screen_id: number;
};

type SeatDefinition = {
  id: number;
  label: string;
  row_label: string;
  col_number: number;
  screen_id: number;
};

type ShowtimeSeatState = {
  showtime_id: string;
  seat_id: number;
  status: 'available' | 'held' | 'reserved';
  version: number;
  hold_id: string | null;
};

type HoldRow = {
  id: string;
  user_id: string;
  showtime_id: string;
  expires_at: Date;
  released_at: Date | null;
};

type UserRow = {
  id: string;
  email: string;
  email_verified_at: Date | null;
};

const showtimes = new Map<string, ShowtimeRow>();
const screenSeats = new Map<number, SeatDefinition>();
const showtimeSeats = new Map<string, ShowtimeSeatState[]>();
const holds = new Map<string, HoldRow>();
const users = new Map<string, UserRow>();

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

const unverifiedToken = signTestToken({
  sub: UNVERIFIED_USER_ID,
  email: 'unverified@arekta.local',
  role: 'user',
});

const env = loadEnv();
const logger = createLogger({ ...env, LOG_LEVEL: 'silent', HOLD_TTL_SECONDS: 600 });
const app = createApp({ ...env, HOLD_TTL_SECONDS: 600, IMGBB_API_KEY: 'test-imgbb-key' }, logger);
const seatsService = createSeatsService({ ...env, HOLD_TTL_SECONDS: 600 });

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

function seedShowtime(id = SHOWTIME_ID): void {
  showtimes.set(id, {
    id,
    status: 'scheduled',
    price_cents: 1200,
    screen_id: 1,
  });

  showtimeSeats.set(
    id,
    [...screenSeats.values()].map((seat) => ({
      showtime_id: id,
      seat_id: seat.id,
      status: 'available' as const,
      version: 0,
      hold_id: null,
    })),
  );
}

function seedUsers(): void {
  users.set(USER_ID, {
    id: USER_ID,
    email: 'user@arekta.local',
    email_verified_at: new Date(),
  });
  users.set(OTHER_USER_ID, {
    id: OTHER_USER_ID,
    email: 'other@arekta.local',
    email_verified_at: new Date(),
  });
  users.set(UNVERIFIED_USER_ID, {
    id: UNVERIFIED_USER_ID,
    email: 'unverified@arekta.local',
    email_verified_at: null,
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
  const states = showtimeSeats.get(showtimeId) ?? [];
  for (const seatId of seatIds) {
    const seat = states.find((row) => row.seat_id === seatId);
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

function simulateReleaseHold(holdId: string, userId: string): void {
  const hold = holds.get(holdId);
  if (
    !hold ||
    hold.user_id !== userId ||
    hold.released_at !== null ||
    hold.expires_at.getTime() <= Date.now()
  ) {
    const error = new Error('hold_not_found') as Error & { code: string };
    error.code = 'P0002';
    throw error;
  }

  hold.released_at = new Date();
  for (const seat of showtimeSeats.get(hold.showtime_id) ?? []) {
    if (seat.hold_id === holdId) {
      seat.status = 'available';
      seat.hold_id = null;
      seat.version += 1;
    }
  }
}

function simulateExpireHold(holdId: string): number[] {
  const hold = holds.get(holdId);
  if (!hold || hold.released_at !== null || hold.expires_at.getTime() > Date.now()) {
    return [];
  }

  hold.released_at = new Date();
  const releasedSeatIds: number[] = [];
  for (const seat of showtimeSeats.get(hold.showtime_id) ?? []) {
    if (seat.hold_id === holdId && seat.status === 'held') {
      seat.status = 'available';
      seat.hold_id = null;
      seat.version += 1;
      releasedSeatIds.push(seat.seat_id);
    }
  }
  return releasedSeatIds;
}

function buildSeatMapRows(showtimeId: string) {
  const showtime = showtimes.get(showtimeId);
  if (!showtime) {
    return [];
  }

  const states = showtimeSeats.get(showtimeId) ?? [];
  return states
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
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) =>
      a.row_label === b.row_label ? a.col_number - b.col_number : a.row_label.localeCompare(b.row_label),
    );
}

function installDbMocks(): void {
  const handleRead = async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM showtimes st') && sql.includes('INNER JOIN screens sc')) {
      const showtimeId = params?.[0] as string;
      return { rows: buildSeatMapRows(showtimeId), rowCount: buildSeatMapRows(showtimeId).length };
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

    if (sql.includes('FROM showtime_seats ss') && sql.includes('WHERE ss.hold_id = $1')) {
      const holdId = params?.[0] as string;
      if (sql.includes('ORDER BY s.row_label')) {
        const rows = [...screenSeats.values()]
          .map((seat) => {
            const state = getShowtimeSeat(
              holds.get(holdId)?.showtime_id ?? '',
              seat.id,
            );
            if (!state || state.hold_id !== holdId) {
              return null;
            }
            return { seat_id: seat.id, label: seat.label };
          })
          .filter((row): row is { seat_id: number; label: string } => row !== null);
        return { rows, rowCount: rows.length };
      }

      const rows = (showtimeSeats.get(holds.get(holdId)?.showtime_id ?? '') ?? [])
        .filter((seat) => seat.hold_id === holdId)
        .map((seat) => ({ seat_id: seat.seat_id }));
      return { rows, rowCount: rows.length };
    }

    if (sql.includes('FROM seat_holds') && sql.includes('expires_at <= NOW()')) {
      const rows = [...holds.values()]
        .filter((hold) => hold.released_at === null && hold.expires_at.getTime() <= Date.now())
        .map((hold) => ({ id: hold.id, showtime_id: hold.showtime_id }));
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
            role: 'user',
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

    if (sql.includes('fn_release_hold')) {
      simulateReleaseHold(params?.[0] as string, params?.[1] as string);
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('fn_expire_hold')) {
      const seatIds = simulateExpireHold(params?.[0] as string);
      return { rows: [{ seat_ids: seatIds }], rowCount: 1 };
    }

    if (sql.trimStart().startsWith('SELECT')) {
      return handleRead(sql, params);
    }

    return { rows: [], rowCount: 0 };
  };

  vi.mocked(queryRead).mockImplementation(handleRead);
  vi.mocked(queryWrite).mockImplementation(handleWrite);
}

describe('Seats & Holds API', () => {
  beforeEach(() => {
    showtimes.clear();
    showtimeSeats.clear();
    holds.clear();
    users.clear();
    resetMockRedisStore();
    installDbMocks();
    seedScreenSeats();
    seedShowtime();
    seedUsers();
  });

  it('GET /showtimes/:id/seats → 200 with 10x12 grid and 120 seats', async () => {
    const res = await request(app).get(`/showtimes/${SHOWTIME_ID}/seats`);

    expect(res.status).toBe(200);
    const parsed = seatMapResponseSchema.parse(res.body);
    expect(parsed.showtimeId).toBe(SHOWTIME_ID);
    expect(parsed.rows).toBe(10);
    expect(parsed.cols).toBe(12);
    expect(parsed.priceCents).toBe(1200);

    const totalSeats = parsed.seats.flat().length;
    expect(totalSeats).toBe(120);
  });

  it('GET /showtimes/:id/seats grid structure matches rows and cols', async () => {
    const res = await request(app).get(`/showtimes/${SHOWTIME_ID}/seats`);

    expect(res.status).toBe(200);
    expect(res.body.seats).toHaveLength(10);
    for (const row of res.body.seats) {
      expect(row).toHaveLength(12);
    }
  });

  it('GET /showtimes/:id/seats unknown showtime → 404', async () => {
    const res = await request(app).get(`/showtimes/${OTHER_SHOWTIME_ID}/seats`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('POST /seats/hold one available seat → 200 + holdToken', async () => {
    const res = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [5] });

    expect(res.status).toBe(200);
    const parsed = holdSeatsResponseSchema.parse(res.body);
    expect(parsed.holdToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(parsed.seats).toEqual([{ seatId: 5, label: 'A5' }]);
    expect(getShowtimeSeat(SHOWTIME_ID, 5)?.status).toBe('held');
  });

  it('POST /seats/hold same seat by another user → 409', async () => {
    await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [5] });

    const res = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [5] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS_UNAVAILABLE');
  });

  it('POST /seats/hold without auth → 401', async () => {
    const res = await request(app)
      .post('/seats/hold')
      .send({ showtimeId: SHOWTIME_ID, seatIds: [1] });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /seats/hold unverified email user → 403', async () => {
    const res = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${unverifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [1] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /seats/hold seats [1,2,3] all available → 200 all three', async () => {
    const res = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [1, 2, 3] });

    expect(res.status).toBe(200);
    expect(res.body.seats).toHaveLength(3);
    expect(getShowtimeSeat(SHOWTIME_ID, 1)?.status).toBe('held');
    expect(getShowtimeSeat(SHOWTIME_ID, 2)?.status).toBe('held');
    expect(getShowtimeSeat(SHOWTIME_ID, 3)?.status).toBe('held');
  });

  it('POST /seats/hold [1, 99] where 99 taken → 409 and seat 1 stays available', async () => {
    const takenSeat = getShowtimeSeat(SHOWTIME_ID, 99);
    if (takenSeat) {
      takenSeat.status = 'held';
      takenSeat.hold_id = 'existing-hold';
    }

    const res = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [1, 99] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS_UNAVAILABLE');
    expect(getShowtimeSeat(SHOWTIME_ID, 1)?.status).toBe('available');
  });

  it('POST /seats/hold more than 10 seats → 400', async () => {
    const seatIds = Array.from({ length: 11 }, (_, index) => index + 1);

    const res = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /seats/hold valid token → 204 and seats return to available', async () => {
    const holdRes = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [7] });

    const holdToken = holdRes.body.holdToken as string;

    const res = await request(app)
      .delete('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ holdToken });

    expect(res.status).toBe(204);
    expect(getShowtimeSeat(SHOWTIME_ID, 7)?.status).toBe('available');
  });

  it('DELETE /seats/hold wrong user → 403', async () => {
    const holdRes = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [8] });

    const holdToken = holdRes.body.holdToken as string;

    const res = await request(app)
      .delete('/seats/hold')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ holdToken });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /seats/hold/:token active hold → 200 with seats + expiresAt', async () => {
    const holdRes = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [10] });

    const holdToken = holdRes.body.holdToken as string;

    const res = await request(app)
      .get(`/seats/hold/${holdToken}`)
      .set('Authorization', `Bearer ${verifiedToken}`);

    expect(res.status).toBe(200);
    const parsed = holdStatusResponseSchema.parse(res.body);
    expect(parsed.holdToken).toBe(holdToken);
    expect(parsed.showtimeId).toBe(SHOWTIME_ID);
    expect(parsed.seats).toEqual([{ seatId: 10, label: 'A10' }]);
    expect(parsed.expiresAt).toBeTruthy();
  });

  it('expireStaleHolds releases seats after TTL', async () => {
    const holdRes = await request(app)
      .post('/seats/hold')
      .set('Authorization', `Bearer ${verifiedToken}`)
      .send({ showtimeId: SHOWTIME_ID, seatIds: [11] });

    const holdToken = holdRes.body.holdToken as string;
    const hold = holds.get(holdToken);
    if (hold) {
      hold.expires_at = new Date(Date.now() - 1000);
    }

    const released = await seatsService.expireStaleHolds();
    expect(released).toBe(1);
    expect(getShowtimeSeat(SHOWTIME_ID, 11)?.status).toBe('available');
  });

  it('concurrent holds on same seat — exactly one wins', async () => {
    const [first, second] = await Promise.all([
      request(app)
        .post('/seats/hold')
        .set('Authorization', `Bearer ${verifiedToken}`)
        .send({ showtimeId: SHOWTIME_ID, seatIds: [20] }),
      request(app)
        .post('/seats/hold')
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({ showtimeId: SHOWTIME_ID, seatIds: [20] }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(getShowtimeSeat(SHOWTIME_ID, 20)?.status).toBe('held');
  });
});
